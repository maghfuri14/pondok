import { apiRequest, isApiMode } from './apiClient';
import { syncFromApi } from './apiCache';

/** Simpan desain kwitansi ke API saat mode produksi, atau localStorage saat mode lokal. */
export async function simpanKwitansiConfig(config: unknown): Promise<void> {
  if (isApiMode()) {
    await apiRequest('/api/master/pengaturan/kwitansi_config', {
      method: 'PUT',
      body: JSON.stringify({ nilai: config }),
    });
    await syncFromApi();
    return;
  }
  localStorage.setItem('al_hidayah_kwitansi_config', JSON.stringify(config));
}
