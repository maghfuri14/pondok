import type { ApiMode } from './apiClient';

const MODE_KEY = 'al_hidayah_mode';
const VERSION_KEY = 'al_hidayah_storage_version';
const VERSION = '2';

/**
 * Bersihkan cache localStorage sekali kali ketika versi/mode berubah.
 * Mencegah data hasil sinkron API (mis. 3 santri smoke) tetap dipakai
 * ketika aplikasi kembali ke mode lokal, dan sebaliknya.
 */
export function siapkanStorage(mode: ApiMode): void {
  if (typeof localStorage === 'undefined') return;

  const modeSebelumnya = localStorage.getItem(MODE_KEY);
  const versiSebelumnya = localStorage.getItem(VERSION_KEY);
  const perluBersih = versiSebelumnya !== VERSION || (modeSebelumnya && modeSebelumnya !== mode);

  if (perluBersih) {
    const kunci = Object.keys(localStorage).filter((key) => key.startsWith('al_hidayah_'));
    kunci.forEach((key) => localStorage.removeItem(key));
    localStorage.setItem(VERSION_KEY, VERSION);
  }

  localStorage.setItem(MODE_KEY, mode);
}
