import { Router } from 'express';
import type { PoolConnection } from 'mysql2/promise';
import { requireAuth, requireRole } from '../auth';
import { logActivity } from '../audit';
import { execute, query, withTransaction, type Rows } from '../db';
import { asyncHandler, badRequest, conflict, notFound } from '../errors';
import { newId } from '../id';
import { ADMIN_ROLES } from '../roles';
import { requireOneOf, requireText } from '../validation';
async function tarifSyahriyah(kategori: string, tahun: number, bulan: number): Promise<number> {
  const ym = `${tahun}-${String(bulan).padStart(2, '0')}`;
  const settings = await query<Rows>("SELECT nilai FROM pengaturan WHERE kunci = 'tarif'");
  const nilai = settings[0]
    ? typeof settings[0].nilai === 'string'
      ? JSON.parse(settings[0].nilai)
      : settings[0].nilai
    : {};
  let berlaku = nilai as Record<string, any>;
  if (ym < String(berlaku.periode_mulai || `${tahun}-01`)) {
    const arsip = await query<Rows>(
      "SELECT * FROM arsip_tarif WHERE status = 'Diarsipkan' ORDER BY periode_mulai DESC"
    );
    const cocok = arsip.find(
      (a) => ym >= String(a.periode_mulai) && (!a.periode_selesai || ym <= String(a.periode_selesai))
    );
    if (cocok) berlaku = cocok as Record<string, any>;
  }
  return Number(kategori === 'Nduduk' ? berlaku.syahriyah_nduduk : berlaku.syahriyah_mukim) || 0;
}

function potonganKeringanan(
  jenis: string,
  nominalKustom: number,
  tarif: number
): number {
  if (jenis === 'penuh') return tarif;
  if (jenis === 'setengah') return Math.round(tarif / 2);
  return Math.max(0, Math.min(nominalKustom, tarif));
}

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
    const jenis = requireOneOf(req.body?.jenis, ['kustom', 'setengah', 'penuh'] as const, 'Jenis keringanan');
    const nominalPerBulan = Number(req.body?.nominal_per_bulan) || 0;
    if (jenis === 'kustom' && (!Number.isInteger(nominalPerBulan) || nominalPerBulan <= 0)) {
      throw badRequest('Nominal keringanan kustom harus lebih dari 0');
    }
    const keterangan = typeof req.body?.keterangan === 'string' ? req.body.keterangan.trim() : '';

    if (!Number.isInteger(tahun) || tahun < 2000) throw badRequest('Tahun tidak valid');
    if (
      !Number.isInteger(bulanMulai) || !Number.isInteger(bulanSelesai) ||
      bulanMulai < 1 || bulanSelesai > 12 || bulanMulai > bulanSelesai
    ) {
      throw badRequest('Rentang bulan tidak valid');
    }

    const result = await withTransaction(async (conn) => {
      const santriList = await rowsOf(conn, 'SELECT id, nama, kategori FROM santri WHERE id = ?', [santriId]);
      const santri = santriList[0];
      if (!santri) throw notFound('Data santri tidak ditemukan');

      const tarifList: number[] = [];
      for (let bulan = bulanMulai; bulan <= bulanSelesai; bulan += 1) {
        tarifList.push(await tarifSyahriyah(String(santri.kategori), tahun, bulan));
      }
      if (jenis === 'kustom' && nominalPerBulan > Math.min(...tarifList)) {
        throw badRequest(
          `Nominal keringanan tidak boleh melebihi tarif yang berlaku (Rp ${Math.min(...tarifList).toLocaleString('id-ID')})`
        );
      }

      const snapshot: Record<string, number> = {};
      for (let bulan = bulanMulai; bulan <= bulanSelesai; bulan += 1) {
        const tarif = await tarifSyahriyah(String(santri.kategori), tahun, bulan);
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

        const asli = tarif;
        const dibayar = Number(matrix.total_dibayar);
        const tagihanBaru = Math.max(0, asli - potonganKeringanan(jenis, nominalPerBulan, asli));
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
         (id, santri_id, tahun, bulan_mulai, bulan_selesai, jenis, nominal_per_bulan, keterangan, snapshot, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
        [
          id, santriId, tahun, bulanMulai, bulanSelesai, jenis, nominalPerBulan,
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

/**
 * Cabut keringanan mulai bulan berjalan: potong periode, jangan hapus & jangan
 * mengubah bulan yang sudah lunas/ada kwitansi (histori = harga mati).
 */
keringananRoutes.delete(
  '/:id',
  requireRole(...ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    await withTransaction(async (conn) => {
      const waiverList = await rowsOf(conn, 'SELECT * FROM keringanan_syahriyah WHERE id = ?', [req.params.id]);
      const waiver = waiverList[0];
      if (!waiver) throw notFound('Data keringanan tidak ditemukan');

      const mulai = Number(req.body?.dari_bulan) || new Date().getMonth() + 1;
      const bulanMulai = Number(waiver.bulan_mulai);
      const bulanSelesai = Number(waiver.bulan_selesai);
      const potong = mulai > bulanMulai && mulai <= bulanSelesai;

      if (potong) {
        // Kunci bulan sebelum `mulai` yang sudah ada pembayaran.
        const lockRows = await rowsOf(
          conn,
          `SELECT id FROM syahriyah_bulan
           WHERE santri_id = ? AND tahun = ? AND bulan < ? AND total_dibayar > 0`,
          [waiver.santri_id, waiver.tahun, mulai]
        );
        for (const row of lockRows) {
          await conn.execute('UPDATE syahriyah_bulan SET keringanan = 1 WHERE id = ?', [row.id]);
        }
        await conn.execute(
          'UPDATE keringanan_syahriyah SET bulan_selesai = ? WHERE id = ?',
          [mulai - 1, req.params.id]
        );
        await logActivity(
          {
            modul: 'Syahriyah',
            aksi: 'Ubah',
            deskripsi: `Keringanan ${req.params.id} dipotong sampai bulan ${mulai - 1} (mulai bulan ${mulai} tidak berlaku)`,
            ref_id: req.params.id,
            userId: req.user?.id,
          },
          conn
        );
      } else {
        // Belum ada histori → aman dihapus total.
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
      }
    });
    res.status(204).end();
  })
);
