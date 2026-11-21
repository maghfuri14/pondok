import { readJsonStrict } from './core';
import { apiRequest, isApiMode } from './apiClient';
import { syncFromApi } from './apiCache';
import { syahriyahService, getTarifSyahriyah } from './syahriyahService';
import { santriService } from './santriService';
import { activityLogService } from './activityLogService';

const BULAN_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Ags', 'Sep', 'Okt', 'Nov', 'Des'];

export type JenisKeringanan = 'kustom' | 'setengah' | 'penuh';

export interface SyahriyahWaiver {
  id: string;
  santri_id: string;
  tahun: number;
  bulan_mulai: number;
  bulan_selesai: number;
  jenis: JenisKeringanan;
  /** Nominal potongan untuk jenis 'kustom'; diabaikan untuk 50%/penuh. */
  nominal_per_bulan: number;
  keterangan?: string;
  /** Nominal tagihan sebelum keringanan (untuk data lama / restore). */
  snapshot: Record<string, number>;
  created_at: string;
}

export interface KeringananInput {
  santri_id: string;
  tahun: number;
  bulan_mulai: number;
  bulan_selesai: number;
  jenis: JenisKeringanan;
  nominal_per_bulan?: number;
  keterangan?: string;
}

const STORAGE_KEY = 'al_hidayah_syahriyah_waivers';

const bacaLokal = (): SyahriyahWaiver[] =>
  readJsonStrict<SyahriyahWaiver[]>(STORAGE_KEY, []).map((w) => ({
    ...w,
    jenis: w.jenis || 'kustom',
    nominal_per_bulan: w.nominal_per_bulan || 0,
  }));

const tulisLokal = (list: SyahriyahWaiver[]): void => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
};

/** Potongan rupiah berdasarkan jenis keringanan & tarif yang berlaku. */
export function hitungPotongan(
  jenis: JenisKeringanan,
  nominalKustom: number,
  tarif: number
): number {
  if (jenis === 'penuh') return tarif;
  if (jenis === 'setengah') return Math.round(tarif / 2);
  return Math.max(0, Math.min(nominalKustom || 0, tarif));
}

/** Label singkat untuk badge/tampilan. */
export function labelKeringanan(w: Pick<SyahriyahWaiver, 'jenis' | 'nominal_per_bulan'>): string {
  if (w.jenis === 'penuh') return 'Keringanan Penuh';
  if (w.jenis === 'setengah') return 'Keringanan 50%';
  return `Keringanan Rp ${(w.nominal_per_bulan || 0).toLocaleString('id-ID')}`;
}

const tumpangTindih = (
  waivers: SyahriyahWaiver[],
  santriId: string,
  tahun: number,
  mulai: number,
  selesai: number
): boolean =>
  waivers.some(
    (w) =>
      w.santri_id === santriId &&
      w.tahun === tahun &&
      w.bulan_mulai <= selesai &&
      w.bulan_selesai >= mulai
  );

/**
 * Keringanan tagihan syahriyah khusus Super Admin.
 * Tarif yang berlaku menjadi dasar, lalu dikurangi potongan keringanan.
 */
export const waiverService = {
  async getAll(santriId?: string, tahun?: number): Promise<SyahriyahWaiver[]> {
    if (isApiMode()) {
      const params = new URLSearchParams();
      if (santriId) params.set('santri_id', santriId);
      if (tahun) params.set('tahun', String(tahun));
      const response = await apiRequest<{ data: SyahriyahWaiver[] }>(
        `/api/keringanan?${params.toString()}`
      );
      return response.data.map((w) => ({ ...w, jenis: w.jenis || 'kustom' }));
    }
    return bacaLokal().filter(
      (w) => (!santriId || w.santri_id === santriId) && (!tahun || w.tahun === tahun)
    );
  },

  async create(input: KeringananInput): Promise<SyahriyahWaiver> {
    if (
      !Number.isInteger(input.tahun) || input.tahun < 2000 ||
      !Number.isInteger(input.bulan_mulai) || !Number.isInteger(input.bulan_selesai) ||
      input.bulan_mulai < 1 || input.bulan_selesai > 12 || input.bulan_mulai > input.bulan_selesai ||
      !['kustom', 'setengah', 'penuh'].includes(input.jenis)
    ) {
      throw new Error('Data keringanan tidak valid');
    }
    const nominalKustom = Number(input.nominal_per_bulan) || 0;
    if (input.jenis === 'kustom' && (!Number.isInteger(nominalKustom) || nominalKustom <= 0)) {
      throw new Error('Nominal keringanan kustom harus lebih dari 0');
    }

    if (isApiMode()) {
      await apiRequest('/api/keringanan/syahriyah', {
        method: 'POST',
        body: JSON.stringify({ ...input, nominal_per_bulan: nominalKustom }),
      });
      await syncFromApi();
      return { ...input, nominal_per_bulan: nominalKustom, id: '', snapshot: {}, created_at: '' };
    }

    const list = bacaLokal();
    if (tumpangTindih(list, input.santri_id, input.tahun, input.bulan_mulai, input.bulan_selesai)) {
      throw new Error('Rentang bulan tersebut sudah memiliki keringanan');
    }

    const santri = await santriService.getSantriById(input.santri_id).catch(() => null);
    if (!santri) throw new Error('Data santri tidak ditemukan');
    const kategori = santri.kategori;

    const snapshot: Record<string, number> = {};
    const tarifList: number[] = [];
    for (let bulan = input.bulan_mulai; bulan <= input.bulan_selesai; bulan += 1) {
      tarifList.push(await getTarifSyahriyah(kategori, input.tahun, bulan));
    }
    const tarifTerkecil = Math.min(...tarifList);
    if (input.jenis === 'kustom' && nominalKustom > tarifTerkecil) {
      throw new Error(
        `Nominal keringanan (Rp ${nominalKustom.toLocaleString('id-ID')}) tidak boleh melebihi tarif yang berlaku (Rp ${tarifTerkecil.toLocaleString('id-ID')})`
      );
    }

    for (let bulan = input.bulan_mulai; bulan <= input.bulan_selesai; bulan += 1) {
      const tarif = await getTarifSyahriyah(kategori, input.tahun, bulan);
      const potongan = hitungPotongan(input.jenis, nominalKustom, tarif);
      snapshot[String(bulan)] = tarif;
      await syahriyahService.setNominalTagihan(
        input.santri_id,
        input.tahun,
        bulan,
        Math.max(0, tarif - potongan)
      );
    }

    const waiver: SyahriyahWaiver = {
      ...input,
      nominal_per_bulan: nominalKustom,
      id: `w_${Date.now()}`,
      snapshot,
      created_at: new Date().toISOString(),
    };
    tulisLokal([waiver, ...list]);

    activityLogService.catat({
      modul: 'Syahriyah',
      aksi: 'Ubah',
      deskripsi: `${labelKeringanan(waiver)} ${santri.nama} bulan ${input.bulan_mulai}–${input.bulan_selesai}/${input.tahun}`,
      ref_id: input.santri_id,
    });
    return waiver;
  },

  /**
   * Cabut keringanan mulai bulan berjalan.
   * HISTORI = HARGA MATI: bulan-bulan yang sudah lunas tetap memakai keringanan lama.
   * Jika pencabutan mulai setelah bulan_mulai → periode dipotong, record dipertahankan.
   */
  async hapus(id: string, dariBulan?: number): Promise<void> {
    if (isApiMode()) {
      await apiRequest(`/api/keringanan/${id}`, {
        method: 'DELETE',
        body: dariBulan ? JSON.stringify({ dari_bulan: dariBulan }) : undefined,
      });
      await syncFromApi();
      return;
    }

    const list = bacaLokal();
    const waiver = list.find((w) => w.id === id);
    if (!waiver) throw new Error('Data keringanan tidak ditemukan');
    const santri = await santriService.getSantriById(waiver.santri_id).catch(() => null);
    const nama = santri?.nama || waiver.santri_id;

    const mulai = dariBulan ?? new Date().getMonth() + 1;
    const potong = mulai > waiver.bulan_mulai && mulai <= waiver.bulan_selesai;

    if (potong) {
      // Kunci bulan sebelum `mulai`: sudah terikat keringanan saat transaksi terjadi.
      const matrix = readJsonStrict<Record<string, Record<string, Array<Record<string, unknown>>>>>(
        'al_hidayah_syahriyah', {}
      );
      const rows = matrix[waiver.santri_id]?.[String(waiver.tahun)] || [];
      for (const row of rows) {
        const bulan = Number(row.bulan);
        if (bulan < mulai && (Number(row.total_dibayar) || 0) > 0) {
          row.keringanan = true;
        }
      }
      localStorage.setItem('al_hidayah_syahriyah', JSON.stringify(matrix));

      const dipotong: SyahriyahWaiver = {
        ...waiver,
        bulan_selesai: mulai - 1,
      };
      tulisLokal(list.map((w) => (w.id === id ? dipotong : w)));

      activityLogService.catat({
        modul: 'Syahriyah',
        aksi: 'Ubah',
        deskripsi: `${labelKeringanan(waiver)} ${nama} dipotong sampai ${
          BULAN_NAMES[mulai - 2]
        } (mulai ${BULAN_NAMES[mulai - 1]} tidak berlaku)`,
        ref_id: waiver.santri_id,
      });
      return;
    }

    // Belum ada histori yang terkena → aman dihapus total.
    tulisLokal(list.filter((w) => w.id !== id));
    activityLogService.catat({
      modul: 'Syahriyah',
      aksi: 'Hapus',
      deskripsi: `Mencabut ${labelKeringanan(waiver)} ${nama} (${waiver.tahun})`,
      ref_id: waiver.santri_id,
    });
  },
};
