import {
  SyahriyahBulan,
  StatusSyahriyah,
  SyahriyahItemInput,
  SyahriyahTransaksiData,
  SyahriyahTransaksiRecord,
} from '../types/syahriyah';
import { Santri } from '../types/santri';
import { santriService } from './santriService';
import { kasService, KAS_STORAGE_KEY } from './kasService';
import { activityLogService } from './activityLogService';
import { getTarifForPeriod, pengaturanService } from './pengaturanService';
import {
  generateId,
  isBulanGapNonaktif,
  isAfterKeluar as coreIsAfterKeluar,
  isNominalValid,
  nextNomorKuitansi,
  readJsonStrict,
  snapshotKeys,
  KEY_NOMOR_KUITANSI,
  isValidCalendarDate,
} from './core';

const STORAGE_KEY = 'al_hidayah_syahriyah';
const TRANSAKSI_KEY = 'al_hidayah_syahriyah_transaksi';
const SANTRI_KEY = 'al_hidayah_santri';

const BULAN_SINGKAT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Ags', 'Sep', 'Okt', 'Nov', 'Des'];

/**
 * Tarif syahriyah untuk kategori pada periode tertentu.
 * Tagihan yang sudah ada tetap memakai tarif periode tersebut.
 */
export async function getTarifSyahriyah(kategori: string, tahun?: number, bulan?: number): Promise<number> {
  const tarif =
    tahun != null && bulan != null
      ? await getTarifForPeriod(`${tahun}-${String(bulan).padStart(2, '0')}`)
      : await pengaturanService.getTarif();

  switch (kategori) {
    case 'Mukim':
      return tarif.syahriyah_mukim;
    case 'Nduduk':
      return tarif.syahriyah_nduduk;
    case 'Kilatan':
      // Santri Kilatan tidak dikenakan syahriyah bulanan
      return 0;
    default:
      return tarif.syahriyah_mukim;
  }
}

function delay(ms = 200): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Apakah bulan (tahun, bulan) berada sebelum bulan masuk santri. */
export function isBeforeEntry(tanggalMasuk: string, tahun: number, bulan: number): boolean {
  const m = /^(\d{4})-(\d{2})/.exec(tanggalMasuk || '');
  if (!m) return false;
  const entry = `${m[1]}-${m[2]}`;
  const target = `${tahun}-${String(bulan).padStart(2, '0')}`;
  return target < entry;
}

/**
 * Apakah bulan jatuh di masa tidak aktif santri (tidak ditagih & tidak bisa dibayar)?
 * Prioritas: riwayat periode tidak aktif; fallback data lama: tanggal keluar sederhana.
 */
export function isSyahriyahSetelahKeluar(
  santri: Pick<Santri, 'tanggal_keluar' | 'periode_nonaktif'>,
  tahun: number,
  bulan: number
): boolean {
  if (santri.periode_nonaktif && santri.periode_nonaktif.length) {
    return isBulanGapNonaktif(santri.periode_nonaktif, tahun, bulan);
  }
  return coreIsAfterKeluar(santri.tanggal_keluar, tahun, bulan);
}

/** Buat 12 bulan kosong (Belum) dengan tarif periode. */
export async function createEmptySyahriyahYear(kategori: string, tahun: number): Promise<SyahriyahBulan[]> {
  const result: SyahriyahBulan[] = [];
  for (let bulan = 1; bulan <= 12; bulan++) {
    result.push({
      tahun,
      bulan,
      nominal_tagihan: await getTarifSyahriyah(kategori, tahun, bulan),
      total_dibayar: 0,
      status: 'Belum',
    });
  }
  return result;
}

type MatrixStore = Record<string, Record<number, SyahriyahBulan[]>>;

function getStoredMatrixData(): MatrixStore {
  return readJsonStrict<MatrixStore>(STORAGE_KEY, {});
}

function saveMatrixData(data: MatrixStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function getStoredTransaksiData(): SyahriyahTransaksiRecord[] {
  return readJsonStrict<SyahriyahTransaksiRecord[]>(TRANSAKSI_KEY, []);
}

function saveTransaksiData(list: SyahriyahTransaksiRecord[]): void {
  localStorage.setItem(TRANSAKSI_KEY, JSON.stringify(list));
}

/** Daftar bulan (YYYY-MM) yang sudah ada pembayaran syahriyah. */
export function getSyahriyahMonthsWithPayments(): string[] {
  const stored = readJsonStrict<MatrixStore>(STORAGE_KEY, {});
  const months = new Set<string>();
  for (const santriId of Object.keys(stored)) {
    for (const tahunStr of Object.keys(stored[santriId])) {
      const tahun = parseInt(tahunStr, 10);
      for (const r of stored[santriId][tahun] || []) {
        if (r.total_dibayar > 0) {
          months.add(`${tahun}-${String(r.bulan).padStart(2, '0')}`);
        }
      }
    }
  }
  return Array.from(months).sort();
}

/**
 * Perbarui nominal tagihan yang BELUM dibayar untuk bulan >= periodeMulai.
 * Tagihan yang sudah ada pembayaran tidak pernah diubah.
 */
export async function applyNewTarifToUnpaidMonths(
  periodeMulai: string,
  getNominal: (kategori: string, tahun: number, bulan: number) => Promise<number>
): Promise<number> {
  const stored = readJsonStrict<MatrixStore>(STORAGE_KEY, {});
  const santriList = await santriService.getSantriList();
  const kategoriById: Record<string, string> = {};
  santriList.forEach((s) => (kategoriById[s.id] = s.kategori));

  let updatedCount = 0;
  for (const santriId of Object.keys(stored)) {
    const kategori = kategoriById[santriId];
    if (!kategori || kategori === 'Kilatan') continue;
    for (const tahunStr of Object.keys(stored[santriId])) {
      const tahun = parseInt(tahunStr, 10);
      const yearRecords = stored[santriId][tahun] || [];
      const newRecords: SyahriyahBulan[] = [];
      for (const r of yearRecords) {
        const ym = `${r.tahun}-${String(r.bulan).padStart(2, '0')}`;
        if (ym >= periodeMulai && r.total_dibayar === 0) {
          const newNominal = await getNominal(kategori, r.tahun, r.bulan);
          if (newNominal !== r.nominal_tagihan) {
            updatedCount++;
            newRecords.push({ ...r, nominal_tagihan: newNominal, status: 'Belum' as StatusSyahriyah });
            continue;
          }
        }
        newRecords.push(r);
      }
      stored[santriId][tahun] = newRecords;
    }
  }
  saveMatrixData(stored);
  return updatedCount;
}

export const syahriyahService = {
  async getTransaksiList(): Promise<SyahriyahTransaksiRecord[]> {
    return getStoredTransaksiData();
  },

  /**
   * Matrix syahriyah. Nominal tagihan yang sudah dibayar dikunci (tarif historis).
   */
  async getSyahriyahMatrix(
    tahun: number
  ): Promise<{ santri: Santri; records: SyahriyahBulan[] }[]> {
    await delay(200);
    const santriList = (await santriService.getSantriList()).filter((s) => s.kategori !== 'Kilatan');
    const stored = getStoredMatrixData();

    const matrix = await Promise.all(santriList.map(async (s) => {
      let records: SyahriyahBulan[];

      if (stored[s.id] && stored[s.id][tahun]) {
        records = await Promise.all(stored[s.id][tahun].map(async (r) => {
          const tarifBerlaku = await getTarifSyahriyah(s.kategori, r.tahun, r.bulan);
          let dibayar = Math.max(0, r.total_dibayar || 0);

          let nominal: number;
          if (dibayar === 0) {
            nominal = tarifBerlaku > 0 ? tarifBerlaku : r.nominal_tagihan || 0;
          } else {
            nominal = r.nominal_tagihan && r.nominal_tagihan > 0 ? r.nominal_tagihan : tarifBerlaku;
            if (nominal > 0 && dibayar > nominal) dibayar = nominal;
          }

          let status: StatusSyahriyah = 'Belum';
          if (nominal > 0 && dibayar >= nominal) status = 'Lunas';
          else if (dibayar > 0) status = 'Sebagian';

          return { ...r, nominal_tagihan: nominal, total_dibayar: dibayar, status };
        }));
      } else {
        records = await createEmptySyahriyahYear(s.kategori, tahun);
      }

      return { santri: s, records };
    }));

    // Simpan nominal yang sudah disinkron hanya jika ada perubahan
    let changed = false;
    for (const row of matrix) {
      if (!stored[row.santri.id]) stored[row.santri.id] = {};
      if (JSON.stringify(stored[row.santri.id][tahun]) !== JSON.stringify(row.records)) {
        stored[row.santri.id][tahun] = row.records;
        changed = true;
      }
    }
    if (changed) saveMatrixData(stored);
    return matrix;
  },

  /**
   * Catat pembayaran syahriyah.
   * Semua validasi dijalankan dulu. Bila pencatatan kas gagal, seluruh
   * perubahan (matriks, transaksi, nomor kuitansi) dikembalikan.
   */
  async simpanPembayaranSyahriyah(
    santriId: string,
    itemsInput: SyahriyahItemInput[],
    transaksiData: SyahriyahTransaksiData
  ): Promise<SyahriyahTransaksiRecord> {
    await delay(300);

    const santri = (await santriService.getSantriList()).find((s) => s.id === santriId);
    if (!santri) throw new Error('Data santri tidak ditemukan');
    if (santri.kategori === 'Kilatan') {
      throw new Error(
        'Santri kategori Kilatan tidak dikenakan syahriyah bulanan. Gunakan menu Kilatan untuk pembayaran event.'
      );
    }
    if (!itemsInput.length) throw new Error('Tidak ada item pembayaran yang dipilih');
    if (!transaksiData.tanggal_bayar || !isValidCalendarDate(transaksiData.tanggal_bayar)) {
      throw new Error('Tanggal bayar tidak valid');
    }

    const seen = new Set<string>();
    for (const item of itemsInput) {
      const key = `${item.tahun}-${item.bulan}`;
      if (seen.has(key)) {
        throw new Error(`Bulan ${item.bulan}/${item.tahun} dipilih lebih dari sekali`);
      }
      seen.add(key);
      if (!isNominalValid(item.nominal)) {
        throw new Error(
          `Nominal pembayaran bulan ${item.bulan}/${item.tahun} harus bilangan bulat rupiah dan lebih dari 0`
        );
      }
    }

    const storedMatrix = getStoredMatrixData();
    if (!storedMatrix[santriId]) storedMatrix[santriId] = {};

    for (const item of itemsInput) {
      if (isBeforeEntry(santri.tanggal_masuk, item.tahun, item.bulan)) {
        throw new Error(
          `Pembayaran tidak dapat dilakukan untuk bulan ${item.bulan} tahun ${item.tahun} karena sebelum tanggal santri masuk (${santri.tanggal_masuk})`
        );
      }
      if (isSyahriyahSetelahKeluar(santri, item.tahun, item.bulan)) {
        throw new Error(
          `Pembayaran tidak dapat dilakukan untuk bulan ${item.bulan} tahun ${item.tahun} karena santri tidak aktif pada bulan tersebut`
        );
      }

      let yearRecords = storedMatrix[santriId][item.tahun];
      if (!yearRecords) {
        yearRecords = await createEmptySyahriyahYear(santri.kategori, item.tahun);
        storedMatrix[santriId][item.tahun] = yearRecords;
      }
      const index = yearRecords.findIndex((r) => r.bulan === item.bulan);
      if (index === -1) throw new Error(`Data bulan ${item.bulan}/${item.tahun} tidak ditemukan`);

      const current = yearRecords[index];
      let nominalTagihan = current.nominal_tagihan || 0;
      if (nominalTagihan <= 0) {
        nominalTagihan = await getTarifSyahriyah(santri.kategori, item.tahun, item.bulan);
      }
      const sudahDibayar = Math.max(0, current.total_dibayar || 0);
      const sisa = Math.max(0, nominalTagihan - sudahDibayar);

      if (sisa <= 0 || current.status === 'Lunas') {
        throw new Error(`Bulan ${item.bulan}/${item.tahun} sudah lunas. Tidak dapat menambah pembayaran.`);
      }
      if (item.nominal > sisa) {
        throw new Error(
          `Nominal pembayaran bulan ${item.bulan}/${item.tahun} (Rp ${item.nominal.toLocaleString('id-ID')}) melebihi sisa tagihan (Rp ${sisa.toLocaleString('id-ID')}).`
        );
      }

      const newTotal = sudahDibayar + item.nominal;
      const newStatus: StatusSyahriyah = newTotal >= nominalTagihan ? 'Lunas' : 'Sebagian';
      yearRecords[index] = {
        ...current,
        nominal_tagihan: nominalTagihan,
        total_dibayar: Math.min(newTotal, nominalTagihan),
        status: newStatus,
      };
    }

    const totalItems = itemsInput.reduce((sum, i) => sum + i.nominal, 0);
    const totalIuranLain = (transaksiData.iuran_tambahan || []).reduce((sum, i) => sum + i.nominal, 0);
    const totalPembayaran = totalItems + totalIuranLain;

    // ── Mulai penulisan. Jika ada yang gagal, kembalikan kondisi semula. ──
    const restore = snapshotKeys([STORAGE_KEY, TRANSAKSI_KEY, KAS_STORAGE_KEY, KEY_NOMOR_KUITANSI]);
    try {
      saveMatrixData(storedMatrix);

      const bulanSummary = itemsInput
        .map((it) => `${BULAN_SINGKAT[it.bulan - 1]} ${it.tahun}`)
        .join(', ');
      let kasKeterangan = `Syahriyah ${santri.nama} (${bulanSummary})`;
      if (transaksiData.iuran_tambahan && transaksiData.iuran_tambahan.length > 0) {
        kasKeterangan += ` + ${transaksiData.iuran_tambahan.map((i) => i.nama).join(', ')}`;
      }
      if (transaksiData.keterangan?.trim()) {
        kasKeterangan += ` (${transaksiData.keterangan.trim()})`;
      }

      const tahunBayar = parseInt(transaksiData.tanggal_bayar.slice(0, 4), 10);
      const recordId = generateId('st');
      const kas = await kasService.createKas({
        jenis: 'Pemasukan',
        kategori_nama: 'Syahriyah',
        tanggal: transaksiData.tanggal_bayar,
        nominal: totalPembayaran,
        keterangan: kasKeterangan,
        sumber: { modul: 'syahriyah', ref_id: recordId },
      });

      const newRecord: SyahriyahTransaksiRecord = {
        id: recordId,
        nomor_kuitansi: nextNomorKuitansi(tahunBayar),
        kas_id: kas.id,
        santri_id: santri.id,
        santri_nama: santri.nama,
        santri_nis: santri.nis,
        items: itemsInput,
        transaksi_data: transaksiData,
        total_pembayaran: totalPembayaran,
        created_at: new Date().toISOString(),
      };
      saveTransaksiData([newRecord, ...getStoredTransaksiData()]);
      activityLogService.catat({
        modul: 'Syahriyah',
        aksi: 'Pembayaran',
        deskripsi: `Pembayaran syahriyah ${santri.nama} (${newRecord.nomor_kuitansi}) Rp${totalPembayaran.toLocaleString('id-ID')}`,
        ref_id: newRecord.id,
      });
      return newRecord;
    } catch (err) {
      restore();
      throw err;
    }
  },

  /**
   * Batalkan transaksi pembayaran syahriyah (dari modul asal, bukan menu Kas):
   * - total_dibayar di matriks dikurangi sesuai item transaksi (tidak pernah negatif)
   * - status bulan dihitung ulang (Lunas/Sebagian/Belum)
   * - record transaksi dihapus
   * - entri kas terkait dihapus (kasService.deleteKasSumber)
   * - nomor kuitansi TIDAK dipakai ulang (counter tetap maju agar tidak duplikat)
   * Jika salah satu langkah gagal, seluruh perubahan dikembalikan.
   */
  async batalkanPembayaran(recordId: string): Promise<void> {
    const transaksi = getStoredTransaksiData();
    const record = transaksi.find((t) => t.id === recordId);
    if (!record) throw new Error('Transaksi tidak ditemukan atau sudah dibatalkan');

    const storedMatrix = getStoredMatrixData();
    const newMatrix: MatrixStore = JSON.parse(JSON.stringify(storedMatrix));
    for (const item of record.items || []) {
      const yearRecords = newMatrix[record.santri_id]?.[item.tahun];
      const index = (yearRecords || []).findIndex((r) => r.bulan === item.bulan);
      if (index === -1) {
        throw new Error(
          `Data matriks bulan ${item.bulan}/${item.tahun} tidak ditemukan; pembatalan tetap memerlukan data tersebut`
        );
      }
      const current = yearRecords[index];
      const sisaDibayar = Math.max(0, (current.total_dibayar || 0) - item.nominal);
      const nominal = current.nominal_tagihan || 0;
      const status: StatusSyahriyah =
        nominal > 0 && sisaDibayar >= nominal ? 'Lunas' : sisaDibayar > 0 ? 'Sebagian' : 'Belum';
      yearRecords[index] = { ...current, total_dibayar: sisaDibayar, status };
    }

    // Mulai penulisan dengan snapshot agar bisa dikembalikan bila gagal
    const restore = snapshotKeys([STORAGE_KEY, TRANSAKSI_KEY, KAS_STORAGE_KEY]);
    try {
      saveMatrixData(newMatrix);
      saveTransaksiData(transaksi.filter((t) => t.id !== recordId));
      await kasService.deleteKasSumber('syahriyah', record.id);
      activityLogService.catat({
        modul: 'Syahriyah',
        aksi: 'Pembatalan',
        deskripsi: `Membatalkan pembayaran syahriyah ${record.santri_nama} (${record.nomor_kuitansi})`,
        ref_id: record.id,
      });
    } catch (err) {
      restore();
      throw err;
    }
  },
};

