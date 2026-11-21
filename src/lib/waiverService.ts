import { readJsonStrict } from './core';
import { apiRequest, isApiMode } from './apiClient';
import { syncFromApi } from './apiCache';
import { syahriyahService, getTarifSyahriyah } from './syahriyahService';
import { santriService } from './santriService';
import { activityLogService } from './activityLogService';

export type JenisKeringanan = 'kustom' | 'setengah' | 'penuh';

export interface SyahriyahWaiver {
  id: string;
  santri_id: string;
  tahun: number;
  bulan_mulai: number;
  bulan_selesai: number;
  jenis: JenisKeringanan;
  /** Tahun akhir — bisa lintas tahun ke depan; default = tahun. */
  tahun_selesai?: number;
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
  waivers.some((w) => {
    // Kurun absolut: tahun * 12 + (bulan - 1) — bisa lintas tahun ke depan.
    const startAbs = Number(w.tahun) * 12 + (Number(w.bulan_mulai) - 1);
    const endAbs =
      (Number(w.tahun_selesai ?? w.tahun)) * 12 + (Number(w.bulan_selesai) - 1);
    const newStartAbs = tahun * 12 + (mulai - 1);
    const newEndAbs = (tahun + (selesai < mulai ? 1 : 0)) * 12 + (selesai - 1);
    return w.santri_id === santriId && startAbs <= newEndAbs && endAbs >= newStartAbs;
  });

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
      (w) =>
        (!santriId || w.santri_id === santriId) &&
        (!tahun || (w.tahun <= tahun && Number(w.tahun_selesai ?? w.tahun) >= tahun))
    );
  },

  async create(input: KeringananInput): Promise<SyahriyahWaiver> {
    // Kurun lintas tahun: selesai < mulai ⇔ berakhir pada tahun berikutnya.
    const tahunSelesai = input.tahun + (input.bulan_selesai < input.bulan_mulai ? 1 : 0);
    if (
      !Number.isInteger(input.tahun) || input.tahun < 2000 ||
      !Number.isInteger(input.bulan_mulai) || !Number.isInteger(input.bulan_selesai) ||
      input.bulan_mulai < 1 || input.bulan_selesai < 1 || input.bulan_selesai > 12 ||
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
        body: JSON.stringify({ ...input, tahun_selesai: tahunSelesai, nominal_per_bulan: nominalKustom }),
      });
      await syncFromApi();
      return {
        ...input,
        tahun_selesai: tahunSelesai,
        nominal_per_bulan: nominalKustom,
        id: '',
        snapshot: {},
        created_at: '',
      };
    }

    const list = bacaLokal();
    if (tumpangTindih(list, input.santri_id, input.tahun, input.bulan_mulai, input.bulan_selesai)) {
      throw new Error('Rentang bulan tersebut sudah memiliki keringanan');
    }

    const santri = await santriService.getSantriById(input.santri_id).catch(() => null);
    if (!santri) throw new Error('Data santri tidak ditemukan');
    const kategori = santri.kategori;

    const startAbs = input.tahun * 12 + (input.bulan_mulai - 1);
    const endAbs = tahunSelesai * 12 + (input.bulan_selesai - 1);
    const snapshot: Record<string, number> = {};
    const tarifList: number[] = [];
    for (let abs = startAbs; abs <= endAbs; abs += 1) {
      const y = Math.floor(abs / 12);
      const m = abs - y * 12 + 1;
      tarifList.push(await getTarifSyahriyah(kategori, y, m));
    }
    const tarifTerkecil = Math.min(...tarifList);
    if (input.jenis === 'kustom' && nominalKustom > tarifTerkecil) {
      throw new Error(
        `Nominal keringanan (Rp ${nominalKustom.toLocaleString('id-ID')}) tidak boleh melebihi tarif yang berlaku (Rp ${tarifTerkecil.toLocaleString('id-ID')})`
      );
    }

    for (let i = 0; i < tarifList.length; i += 1) {
      const abs = startAbs + i;
      const y = Math.floor(abs / 12);
      const m = abs - y * 12 + 1;
      const tarif = tarifList[i];
      const potongan = hitungPotongan(input.jenis, nominalKustom, tarif);
      snapshot[String(abs)] = tarif;
      await syahriyahService.setNominalTagihan(input.santri_id, y, m, Math.max(0, tarif - potongan));
    }

    const waiver: SyahriyahWaiver = {
      ...input,
      tahun_selesai: tahunSelesai,
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
   * Cabut keringanan. Histori bulan lunas adalah harga mati:
   * pencabutan hanya memotong periode (`bulan_selesai = dariBulan - 1`),
   * kecuali periode sudah berakhir/belum mulai — maka record dihapus
   * tanpa menyentuh nominal/status bulan sebelumnya.
   */
  async hapus(id: string, dariBulan?: number): Promise<void> {
    if (isApiMode()) {
      await apiRequest(`/api/keringanan/${id}`, {
        method: 'DELETE',
        body: JSON.stringify({ dariBulan }),
      });
      await syncFromApi();
      return;
    }

    const list = bacaLokal();
    const waiver = list.find((w) => w.id === id);
    if (!waiver) throw new Error('Data keringanan tidak ditemukan');
    const santri = await santriService.getSantriById(waiver.santri_id).catch(() => null);
    const startAbs = waiver.tahun * 12 + (Number(waiver.bulan_mulai) - 1);
    const endAbs =
      (Number(waiver.tahun_selesai ?? waiver.tahun)) * 12 + (Number(waiver.bulan_selesai) - 1);
    // Batas pembatalan: bulan berjalan (atau awal record); covered-until = cut - 1.
    const baruSelesai = (dariBulan ?? waiver.bulan_mulai) - 1;
    const newEndAbs = waiver.tahun * 12 + (baruSelesai - 1);

    if (newEndAbs < startAbs || newEndAbs >= endAbs) {
      // Belum mulai (atau batal di bulan awal) / periode sudah berakhir →
      // hapus record tanpa menyentuh matriks lunas sebelumnya (harga mati).
      tulisLokal(list.filter((w) => w.id !== id));
    } else {
      // Potong periode: rekor tetap, bulan sebelum cut tetap terikat keringanan
      // (matrix recalc — guard di getSyahriyahMatrix jaga status lunasnya).
      const newYear = Math.floor(newEndAbs / 12);
      const newMonth = newEndAbs - newYear * 12 + 1;
      tulisLokal(
        list.map((w) => (w.id === id ? { ...w, bulan_selesai: newMonth, tahun_selesai: newYear } : w))
      );
    }

    activityLogService.catat({
      modul: 'Syahriyah',
      aksi: 'Hapus',
      deskripsi: `Mencabut ${labelKeringanan(waiver)} ${santri?.nama || waiver.santri_id} (${waiver.tahun})`,
      ref_id: waiver.santri_id,
    });
  },
};
