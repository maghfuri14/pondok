import { Router } from 'express';
import type { PoolConnection } from 'mysql2/promise';
import { requireAuth, requireRole } from '../auth';
import { logActivity } from '../audit';
import { execute, query, withTransaction, type Rows } from '../db';
import { asyncHandler, badRequest, conflict, notFound } from '../errors';
import { newId } from '../id';
import { ADMIN_ROLES } from '../roles';
import { requirePositiveInteger, requireText } from '../validation';

export const keringananRoutes = Router();

keringananRoutes.use(requireAuth);

type Row = Record<string, any>;

async function rowsOf(conn: PoolConnection, sqlText: string, params: unknown[] = []): Promise<Row[]> {
  const [rows] = await conn.query(sqlText, params);
  return rows as Row[];
}

keringananRoutes.get(
  '/',
  asyncHandler(async (req, res) => {
    const conditions: string[] = ['1 = 1'];
    const params: unknown[] = [];
    if (typeof req.query.santri_id === 'string') {
      conditions.push('santri_id = ?');
      params.push(req.query.santri_id);
    }
    if (typeof req.query.tahun === 'string' && req.query.tahun) {
      conditions.push('tahun = ?');
      params.push(Number(req.query.tahun));
    }
    const rows = await query<Rows>(
      `SELECT * FROM keringanan_syahriyah WHERE ${conditions.join(' AND ')}
       ORDER BY tahun DESC, bulan_mulai DESC LIMIT 500`,
      params
    );
    res.json({ data: rows });
  })
);

/** Super Admin memberi potongan tagihan untuk rentang bulan syahriyah. */
keringananRoutes.post(
  '/syahriyah',
  requireRole(...ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    const santriId = requireText(req.body?.santri_id, 'Santri');
    const tahun = Number(req.body?.tahun);
    const bulanMulai = Number(req.body?.bulan_mulai);
    const bulanSelesai = Number(req.body?.bulan_selesai);
    const nominalPerBulan = requirePositiveInteger(req.body?.nominal_per_bulan, 'Nominal keringanan');
    const keterangan = typeof req.body?.keterangan === 'string' ? req.body.keterangan.trim() : '';

    if (!Number.isInteger(tahun) || tahun < 2000) throw badRequest('Tahun tidak valid');
    if (
      !Number.isInteger(bulanMulai) || !Number.isInteger(bulanSelesai) ||
      bulanMulai < 1 || bulanSelesai > 12 || bulanMulai > bulanSelesai
    ) {
      throw badRequest('Rentang bulan tidak valid');
    }

    const result = await withTransaction(async (conn) => {
      const santriList = await rowsOf(conn, 'SELECT id, nama FROM santri WHERE id = ?', [santriId]);
      const santri = santriList[0];
      if (!santri) throw notFound('Data santri tidak ditemukan');

      const snapshot: Record<string, number> = {};
      for (let bulan = bulanMulai; bulan <= bulanSelesai; bulan += 1) {
        const matrixList = await rowsOf(
          conn,
          `SELECT id, nominal_tagihan, total_dibayar FROM syahriyah_bulan
           WHERE santri_id = ? AND tahun = ? AND bulan = ?`,
          [santriId, tahun, bulan]
        );
        const matrix = matrixList[0];
        if (!matrix) throw badRequest(`Tagihan bulan ${bulan}/${tahun} tidak ditemukan`);

        const bentrok = await rowsOf(
          conn,
          `SELECT id FROM keringanan_syahriyah
           WHERE santri_id = ? AND tahun = ? AND bulan_mulai <= ? AND bulan_selesai >= ? LIMIT 1`,
          [santriId, tahun, bulan, bulan]
        );
        if (bentrok[0]) {
          throw conflict(`Bulan ${bulan}/${tahun} sudah memiliki keringanan`);
        }

        const asli = Number(matrix.nominal_tagihan);
        const dibayar = Number(matrix.total_dibayar);
        const tagihanBaru = Math.max(0, asli - nominalPerBulan);
        const status =
          tagihanBaru === 0
            ? 'Lunas'
            : dibayar >= tagihanBaru
              ? 'Lunas'
              : dibayar > 0
                ? 'Sebagian'
                : 'Belum';

        snapshot[String(bulan)] = asli;
        await conn.execute(
          'UPDATE syahriyah_bulan SET nominal_tagihan = ?, status = ?, keringanan = 1 WHERE id = ?',
          [tagihanBaru, status, matrix.id]
        );
      }

      const id = newId('kr');
      await conn.execute(
        `INSERT INTO keringanan_syahriyah
         (id, santri_id, tahun, bulan_mulai, bulan_selesai, nominal_per_bulan, keterangan, snapshot, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
        [
          id, santriId, tahun, bulanMulai, bulanSelesai, nominalPerBulan,
          keterangan || null,
          JSON.stringify(snapshot),
          req.user?.id ?? null,
        ]
      );

      await logActivity(
        {
          modul: 'Syahriyah',
          aksi: 'Ubah',
          deskripsi: `Keringanan ${santri.nama} bulan ${bulanMulai}–${bulanSelesai}/${tahun} Rp${nominalPerBulan.toLocaleString('id-ID')}/bulan`,
          ref_id: id,
          userId: req.user?.id,
        },
        conn
      );

      return { id };
    });

    res.status(201).json({ data: result });
  })
);

/** Cabut keringanan: kembalikan nominal_tagihan dari snapshot. */
keringananRoutes.delete(
  '/:id',
  requireRole(...ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    await withTransaction(async (conn) => {
      const waiverList = await rowsOf(conn, 'SELECT * FROM keringanan_syahriyah WHERE id = ?', [req.params.id]);
      const waiver = waiverList[0];
      if (!waiver) throw notFound('Data keringanan tidak ditemukan');

      const snapshot =
        typeof waiver.snapshot === 'string' ? JSON.parse(waiver.snapshot) : (waiver.snapshot || {});
      for (const [bulan, nominal] of Object.entries(snapshot as Record<string, number>)) {
        const matrixList = await rowsOf(
          conn,
          'SELECT id, total_dibayar FROM syahriyah_bulan WHERE santri_id = ? AND tahun = ? AND bulan = ?',
          [waiver.santri_id, waiver.tahun, Number(bulan)]
        );
        const matrix = matrixList[0];
        if (!matrix) continue;
        const dibayar = Number(matrix.total_dibayar);
        const status =
          Number(nominal) > 0 && dibayar >= Number(nominal) ? 'Lunas' : dibayar > 0 ? 'Sebagian' : 'Belum';
        await conn.execute(
          'UPDATE syahriyah_bulan SET nominal_tagihan = ?, status = ?, keringanan = 0 WHERE id = ?',
          [Number(nominal), status, matrix.id]
        );
      }

      await conn.execute('DELETE FROM keringanan_syahriyah WHERE id = ?', [req.params.id]);
      await logActivity(
        {
          modul: 'Syahriyah',
          aksi: 'Hapus',
          deskripsi: `Mencabut keringanan syahriyah ${req.params.id}`,
          ref_id: req.params.id,
          userId: req.user?.id,
        },
        conn
      );
    });
    res.status(204).end();
  })
);
