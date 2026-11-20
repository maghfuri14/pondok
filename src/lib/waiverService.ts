import { readJsonStrict } from './core';
import { apiRequest, isApiMode } from './apiClient';
import { syncFromApi } from './apiCache';
import { syahriyahService } from './syahriyahService';
import { santriService } from './santriService';
import { activityLogService } from './activityLogService';

export interface SyahriyahWaiver {
  id: string;
  santri_id: string;
  tahun: number;
  bulan_mulai: number;
  bulan_selesai: number;
  /** Potongan rupiah per bulan. */
  nominal_per_bulan: number;
  keterangan?: string;
  /** Nominal tagihan asli per bulan, dipakai saat keringanan dicabut. */
  snapshot: Record<string, number>;
  created_at: string;
}

export interface KeringananInput {
  santri_id: string;
  tahun: number;
  bulan_mulai: number;
  bulan_selesai: number;
  nominal_per_bulan: number;
  keterangan?: string;
}

const STORAGE_KEY = 'al_hidayah_syahriyah_waivers';

const bacaLokal = (): SyahriyahWaiver[] => readJsonStrict<SyahriyahWaiver[]>(STORAGE_KEY, []);
const tulisLokal = (list: SyahriyahWaiver[]): void => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
};

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
 * Mode API: tersimpan di tabel `keringanan_syahriyah` & langsung mengubah matriks di server.
 * Mode lokal: tersimpan di localStorage & mengubah matriks lokal dengan snapshot untuk restore.
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
      return response.data;
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
      !Number.isInteger(input.nominal_per_bulan) || input.nominal_per_bulan <= 0
    ) {
      throw new Error('Data keringanan tidak valid');
    }

    if (isApiMode()) {
      await apiRequest('/api/keringanan/syahriyah', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      await syncFromApi();
      return { ...input, id: '', snapshot: {}, created_at: '' };
    }

    const list = bacaLokal();
    if (tumpangTindih(list, input.santri_id, input.tahun, input.bulan_mulai, input.bulan_selesai)) {
      throw new Error('Rentang bulan tersebut sudah memiliki keringanan');
    }

    const matrix = await syahriyahService.getSyahriyahMatrix(input.tahun);
    const records = matrix.find((row) => row.santri.id === input.santri_id)?.records || [];
    const snapshot: Record<string, number> = {};

    for (let bulan = input.bulan_mulai; bulan <= input.bulan_selesai; bulan += 1) {
      const record = records.find((r) => r.bulan === bulan);
      if (!record) throw new Error(`Tagihan bulan ${bulan}/${input.tahun} tidak ditemukan`);
      snapshot[String(bulan)] = record.nominal_tagihan;
      await syahriyahService.setNominalTagihan(
        input.santri_id,
        input.tahun,
        bulan,
        Math.max(0, record.nominal_tagihan - input.nominal_per_bulan)
      );
    }

    const waiver: SyahriyahWaiver = {
      ...input,
      id: `w_${Date.now()}`,
      snapshot,
      created_at: new Date().toISOString(),
    };
    tulisLokal([waiver, ...list]);

    const santri = await santriService.getSantriById(input.santri_id).catch(() => null);
    activityLogService.catat({
      modul: 'Syahriyah',
      aksi: 'Ubah',
      deskripsi: `Keringanan ${santri?.nama || input.santri_id} bulan ${input.bulan_mulai}–${input.bulan_selesai}/${input.tahun} Rp${input.nominal_per_bulan.toLocaleString('id-ID')}/bulan`,
      ref_id: input.santri_id,
    });
    return waiver;
  },

  async hapus(id: string): Promise<void> {
    if (isApiMode()) {
      await apiRequest(`/api/keringanan/${id}`, { method: 'DELETE' });
      await syncFromApi();
      return;
    }

    const list = bacaLokal();
    const waiver = list.find((w) => w.id === id);
    if (!waiver) throw new Error('Data keringanan tidak ditemukan');
    for (const [bulan, nominal] of Object.entries(waiver.snapshot)) {
      await syahriyahService.setNominalTagihan(
        waiver.santri_id,
        waiver.tahun,
        Number(bulan),
        Number(nominal),
        false
      );
    }
    tulisLokal(list.filter((w) => w.id !== id));

    const santri = await santriService.getSantriById(waiver.santri_id).catch(() => null);
    activityLogService.catat({
      modul: 'Syahriyah',
      aksi: 'Hapus',
      deskripsi: `Mencabut keringanan syahriyah ${santri?.nama || waiver.santri_id} (${waiver.tahun})`,
      ref_id: waiver.santri_id,
    });
  },
};
