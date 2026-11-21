import test from 'node:test';
import assert from 'node:assert/strict';
import { hitungPotongan, labelKeringanan } from '../src/lib/waiverService';
import { hitungTagihan, WaiverRingkas } from '../src/lib/tagihanKeringanan';

test('potongan penuh dan setengah mengikuti tarif', () => {
  assert.equal(hitungPotongan('penuh', 0, 150000), 150000);
  assert.equal(hitungPotongan('setengah', 0, 150000), 75000);
  assert.equal(hitungPotongan('setengah', 0, 50000), 25000);
});

test('potongan kustom tidak boleh melebihi tarif', () => {
  assert.equal(hitungPotongan('kustom', 50000, 150000), 50000);
  assert.equal(hitungPotongan('kustom', 200000, 150000), 150000);
});

test('label keringanan singkat', () => {
  assert.equal(labelKeringanan({ jenis: 'penuh', nominal_per_bulan: 0 }), 'Keringanan Penuh');
  assert.equal(labelKeringanan({ jenis: 'setengah', nominal_per_bulan: 0 }), 'Keringanan 50%');
  assert.equal(
    labelKeringanan({ jenis: 'kustom', nominal_per_bulan: 50000 }),
    'Keringanan Rp 50.000'
  );
});

test('hitungTagihan: keringanan lintas tahun (Des 2026 – Jan 2027)', () => {
  const w: WaiverRingkas = {
    santri_id: 's1', tahun: 2026, bulan_mulai: 12, bulan_selesai: 1,
    tahun_selesai: 2027, nominal_per_bulan: 0, jenis: 'setengah',
  };
  const base = { tarifDasar: 50000, waivers: [w], santriId: 's1' };
  const des = hitungTagihan({ ...base, tahun: 2026, bulan: 12, sudahDibayar: 0 });
  const jan = hitungTagihan({ ...base, tahun: 2027, bulan: 1, sudahDibayar: 0 });
  assert.equal(des.jenis, 'setengah');
  assert.equal(des.potongan, 25000);
  assert.equal(jan.jenis, 'setengah');
  assert.equal(jan.potongan, 25000);
  // Diluar rentang → tanpa keringanan.
  const jul = hitungTagihan({ ...base, tahun: 2026, bulan: 7, sudahDibayar: 0 });
  assert.equal(jul.jenis, null);
  // Santri lain tidak dipengaruhi.
  const byS2 = hitungTagihan({ ...base, santriId: 's2', tahun: 2026, bulan: 12, sudahDibayar: 0 });
  assert.equal(byS2.jenis, null);
});

test('hitungTagihan: regresi sama tahun (Des–Jan, selesai >= mulai)', () => {
  const w: WaiverRingkas = {
    santri_id: 's1', tahun: 2026, bulan_mulai: 11, bulan_selesai: 12,
    nominal_per_bulan: 0, jenis: 'setengah',
  };
  const des = hitungTagihan({ tarifDasar: 50000, waivers: [w], santriId: 's1', tahun: 2026, bulan: 11, sudahDibayar: 0 });
  assert.equal(des.jenis, 'setengah');
  assert.equal(des.potongan, 25000);
});

