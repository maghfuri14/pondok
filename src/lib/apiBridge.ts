import { apiRequest, isApiMode, setCsrfToken } from './apiClient';
import { syncFromApi } from './apiCache';
import { authStore, type AuthUser } from '../store/authStore';
import { santriService } from './santriService';
import { kasService } from './kasService';
import { syahriyahService } from './syahriyahService';
import { kilatanService } from './kilatanService';
import { iuranPembayaranService } from './iuranPembayaranService';
import { pendaftaranService } from './pendaftaranService';
import { pengaturanService, masterIuranService } from './pengaturanService';
import { activityLogService } from './activityLogService';
import { printLogService } from './printLogService';

type Row = Record<string, any>;

const post = (path: string, body?: unknown) =>
  apiRequest<any>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const put = (path: string, body: unknown) =>
  apiRequest<any>(path, { method: 'PUT', body: JSON.stringify(body) });
const del = (path: string) => apiRequest<any>(path, { method: 'DELETE' });

function localList<T = Row>(key: string): T[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function localById(key: string, id: string): Row | null {
  return localList<Row>(key).find((row) => row.id === id) || null;
}

async function tulisDanSinkron(path: string, body: unknown, method: 'POST' | 'PUT' = 'POST'): Promise<void> {
  if (method === 'POST') await post(path, body);
  else await put(path, body);
  await syncFromApi();
}

/**
 * Mengalihkan jalur TULIS ke API saat VITE_API_MODE=api.
 * Service pembaca tetap membaca localStorage yang sudah disinkronkan dari
 * /api/backup, sehingga halaman laporan/dashboard tidak perlu diubah.
 */
export async function installApiBridge(): Promise<void> {
  if (!isApiMode()) return;
  await syncFromApi();

  /* ---- Auth ---- */
  (authStore as any).getUser = async (): Promise<AuthUser | null> => {
    try {
      const me = await apiRequest<{ data?: { user?: AuthUser; csrfToken?: string } }>('/api/auth/me');
      if (!me.data?.user) return null;
      setCsrfToken(me.data.csrfToken);
      return me.data.user;
    } catch {
      return null;
    }
  };
  (authStore as any).setUser = (user: AuthUser) =>
    localStorage.setItem('al_hidayah_auth_user', JSON.stringify(user));
  (authStore as any).clearUser = () => {
    localStorage.removeItem('al_hidayah_auth_user');
    setCsrfToken(undefined);
  };
  (authStore as any).logout = async () => {
    try {
      await post('/api/auth/logout');
    } catch {
      // abaikan: sesi lokal tetap dihapus
    }
    (authStore as any).clearUser();
    window.location.href = '/login';
  };

  /* ---- Santri ---- */
  Object.assign(santriService as any, {
    async getSantriList() {
      return localList('al_hidayah_santri');
    },
    async getSantriById(id: string) {
      return localById('al_hidayah_santri', id);
    },
    async checkNisUnik(nis: string, excludeId?: string) {
      const target = nis.trim().toLowerCase();
      return !localList<Row>('al_hidayah_santri').some(
        (s) => String(s.nis).toLowerCase() === target && s.id !== excludeId
      );
    },
    async createSantri(data: Row) {
      const result = await post('/api/master/santri', data);
      await syncFromApi();
      return localById('al_hidayah_santri', result.data.id);
    },
    async updateSantri(id: string, data: Row) {
      await tulisDanSinkron(`/api/master/santri/${id}`, data, 'PUT');
      return localById('al_hidayah_santri', id);
    },
    async deleteSantri(id: string) {
      await del(`/api/master/santri/${id}`);
      await syncFromApi();
    },
    async importSantri(rows: Row[]) {
      const result = await post('/api/master/santri/import', { rows });
      await syncFromApi();
      return result.data;
    },
  });

  /* ---- Kas ---- */
  Object.assign(kasService as any, {
    async getKasList() {
      return localList('al_hidayah_kas');
    },
    async getKasById(id: string) {
      return localById('al_hidayah_kas', id);
    },
    async createKas(data: Row) {
      const result = await post('/api/master/kas', data);
      await syncFromApi();
      return localById('al_hidayah_kas', result.data.id);
    },
    async updateKas(id: string, data: Row) {
      await tulisDanSinkron(`/api/master/kas/${id}`, data, 'PUT');
      return localById('al_hidayah_kas', id);
    },
    async deleteKas(id: string) {
      await del(`/api/master/kas/${id}`);
      await syncFromApi();
    },
    async restoreKas(snapshot: Row) {
      await post('/api/master/kas', snapshot);
      await syncFromApi();
    },
    async deleteKasSumber() {
      // Pembatalan pembayaran di API sudah menghapus kas di server.
    },
    async countKasByKategori(kategori: string, jenis: string) {
      return localList<Row>('al_hidayah_kas').filter(
        (k) => k.jenis === (jenis === 'pemasukan' ? 'Pemasukan' : 'Pengeluaran') &&
          String(k.kategori_nama).trim().toLowerCase() === kategori.trim().toLowerCase()
      ).length;
    },
    async renameKasKategori(jenis: string, oldName: string, newName: string) {
      await tulisDanSinkron(
        `/api/master/kategori-kas/${jenis}/${encodeURIComponent(oldName)}`,
        { nama: newName },
        'PUT'
      );
    },
  });

  /* ---- Syahriyah & Kilatan ---- */
  for (const [modul, service, transaksiKey] of [
    ['syahriyah', syahriyahService, 'al_hidayah_syahriyah_transaksi'],
    ['kilatan', kilatanService, 'al_hidayah_kilatan_transaksi'],
  ] as const) {
    Object.assign(service as any, {
      async simpanPembayaranSyahriyah(santriId: string, items: Row[], data: Row) {
        const result = await post(`/api/pembayaran/${modul}`, {
          santri_id: santriId,
          items,
          tanggal_bayar: data.tanggal_bayar,
          metode: data.metode,
          keterangan: data.keterangan,
          iuran_tambahan: data.iuran_tambahan,
        });
        await syncFromApi();
        return localById(transaksiKey, result.data.id);
      },
      async simpanPembayaranKilatan(santriId: string, items: Row[], data: Row) {
        const result = await post(`/api/pembayaran/${modul}`, {
          santri_id: santriId,
          items,
          tanggal_bayar: data.tanggal_bayar,
          metode: data.metode,
          keterangan: data.keterangan,
          iuran_tambahan: data.iuran_tambahan,
        });
        await syncFromApi();
        return localById(transaksiKey, result.data.id);
      },
      async batalkanPembayaran(id: string) {
        await post(`/api/pembayaran/${modul}/${id}/batalkan`);
        await syncFromApi();
      },
    });
  }

  /* ---- Iuran ---- */
  Object.assign(iuranPembayaranService as any, {
    async catatPembayaran(input: Row) {
      const result = await post('/api/pembayaran/iuran', input);
      await syncFromApi();
      return localById('al_hidayah_iuran_pembayaran', result.data.id);
    },
    async batalkanPembayaran(id: string) {
      await post(`/api/pembayaran/iuran/${id}/batalkan`);
      await syncFromApi();
    },
    async getIuranTambahan() {
      return localList('al_hidayah_iuran_tambahan');
    },
  });

  /* ---- Pendaftaran ---- */
  Object.assign(pendaftaranService as any, {
    async getPendaftaranList() {
      return localList('al_hidayah_pendaftaran');
    },
    async createPendaftaran(data: Row) {
      const result = await post('/api/master/pendaftaran', data);
      await syncFromApi();
      return localById('al_hidayah_pendaftaran', result.data.id);
    },
    async updateStatusPendaftaran(id: string, status: string) {
      await tulisDanSinkron(`/api/master/pendaftaran/${id}`, { status }, 'PUT');
      return localById('al_hidayah_pendaftaran', id);
    },
    async konversiKeSantri(id: string, nis: string, tanggalMasuk: string) {
      const result = await post(`/api/master/pendaftaran/${id}/konversi`, {
        nis,
        tanggal_masuk: tanggalMasuk,
      });
      await syncFromApi();
      return result.data;
    },
    async generateAutoNis() {
      const tahun = new Date().getFullYear().toString();
      let max = 0;
      for (const s of localList<Row>('al_hidayah_santri')) {
        if (String(s.nis).startsWith(tahun)) {
          max = Math.max(max, Number(String(s.nis).slice(tahun.length)) || 0);
        }
      }
      return `${tahun}${String(max + 1).padStart(3, '0')}`;
    },
  });

  /* ---- Pengaturan & master iuran ---- */
  Object.assign(pengaturanService as any, {
    async getProfil() {
      return JSON.parse(localStorage.getItem('al_hidayah_profil') || '{}');
    },
    async saveProfil(profil: Row) {
      await tulisDanSinkron('/api/master/pengaturan/profil', { nilai: profil }, 'PUT');
    },
    async getTarif() {
      return JSON.parse(localStorage.getItem('al_hidayah_tarif') || '{}');
    },
    async saveTarif(tarif: Row) {
      await tulisDanSinkron('/api/master/pengaturan/tarif', { nilai: tarif }, 'PUT');
    },
    async getArsipTarif() {
      return localList('al_hidayah_arsip_tarif');
    },
    async getUsers() {
      return localList('al_hidayah_users');
    },
    async addUser(user: Row) {
      const result = await post('/api/master/users', user);
      await syncFromApi();
      return localById('al_hidayah_users', result.data.id);
    },
    async updateUser(id: string, updated: Row) {
      await tulisDanSinkron(`/api/master/users/${id}`, updated, 'PUT');
    },
    async deleteUser(id: string) {
      await del(`/api/master/users/${id}`);
      await syncFromApi();
    },
  });

  Object.assign(masterIuranService as any, {
    async getAll() {
      return localList('al_hidayah_master_iuran');
    },
    async getAktif() {
      return localList<Row>('al_hidayah_master_iuran').filter((m) => m.status === 'Aktif');
    },
    async create(data: Row) {
      const result = await post('/api/master/master-iuran', data);
      await syncFromApi();
      return localById('al_hidayah_master_iuran', result.data.id);
    },
    async update(id: string, data: Row) {
      await tulisDanSinkron(`/api/master/master-iuran/${id}`, data, 'PUT');
      return localById('al_hidayah_master_iuran', id);
    },
    async remove(id: string) {
      await del(`/api/master/master-iuran/${id}`);
      await syncFromApi();
      return true;
    },
  });

  /* ---- Audit & log cetak ---- */
  Object.assign(activityLogService as any, {
    catat(input: Row) {
      // catat() sinkron di mode lokal → fire-and-forget saat API mode.
      void post('/api/aktivitas', { ...input }).then(() => syncFromApi()).catch(() => undefined);
    },
    getAll() {
      return localList('al_hidayah_activity_log');
    },
    clear() {
      // Riwayat server sengaja tidak dihapus dari klien.
    },
  });

  Object.assign(printLogService as any, {
    addLog(transaksiId: string, type: string, printedBy?: string) {
      void post('/api/print-log', { transaksi_id: transaksiId, type, printed_by: printedBy })
        .then(() => syncFromApi())
        .catch(() => undefined);
      return {
        id: `log_${Date.now()}`,
        transaksi_id: transaksiId,
        type,
        printed_at: new Date().toISOString(),
        printed_by: printedBy,
      };
    },
  });

  // Segarkan cache tiap 30 detik untuk perubahan dari tab lain.
  window.setInterval(() => {
    void syncFromApi().catch(() => undefined);
  }, 30000);
}
