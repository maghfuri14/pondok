import React, { useState, useEffect } from 'react';
import {
  FileSpreadsheet,
  FileText,
  Download,
  Filter,
  RotateCcw,
  SearchX,
  Wallet,
  Users,
  UserPlus,
  CreditCard,
  Printer,
  Eye,
  X,
  HandCoins,
  CalendarDays,
} from 'lucide-react';
import {
  laporanService,
  LaporanKeuanganData,
  LaporanSyahriyahRow,
  LaporanIuranRow,
  LaporanKilatanRow,
} from '../../lib/laporanService';
import { Santri } from '../../types/santri';
import { Pendaftaran } from '../../types/pendaftaran';
import { MasterIuran, JenisPeriodeIuran } from '../../types/pengaturan';
import { formatRupiah, formatSaldo } from '../../lib/formatter';
import { masterIuranService } from '../../lib/pengaturanService';
import {
  exportToCsv,
  exportToExcel,
  exportLaporanToPdf,
  generateLaporanPdfBlobUrl,
  printLaporanPdf,
  ExportLaporanPdfParams,
} from '../../lib/exportHelper';
import { showToast } from '../../components/ui/Toast';

type TabType = 'keuangan' | 'santri' | 'pendaftaran' | 'syahriyah' | 'iuran' | 'kilatan';

const BULAN_OPTIONS = [
  { value: 'Semua', label: 'Semua Bulan' },
  { value: '1', label: 'Januari' },
  { value: '2', label: 'Februari' },
  { value: '3', label: 'Maret' },
  { value: '4', label: 'April' },
  { value: '5', label: 'Mei' },
  { value: '6', label: 'Juni' },
  { value: '7', label: 'Juli' },
  { value: '8', label: 'Agustus' },
  { value: '9', label: 'September' },
  { value: '10', label: 'Oktober' },
  { value: '11', label: 'November' },
  { value: '12', label: 'Desember' },
];

const labelPeriodeIuran = (j: JenisPeriodeIuran): string => {
  if (j === 'sekali') return 'Sekali';
  if (j === 'bulanan') return 'Bulanan';
  return 'Tahunan';
};

const sectionTitles: Record<TabType, string> = {
  keuangan: 'LAPORAN REKAPITULASI KEUANGAN',
  santri: 'LAPORAN DATA SANTRI',
  pendaftaran: 'LAPORAN PENDAFTARAN SANTRI BARU',
  syahriyah: 'LAPORAN REKAPITULASI SYAHRIYAH',
  iuran: 'LAPORAN REKAPITULASI IURAN',
  kilatan: 'LAPORAN REKAPITULASI KILATAN',
};

export const LaporanPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('keuangan');

  // Filter States
  const currentYear = new Date().getFullYear();
  const [tahun, setTahun] = useState<number>(currentYear);
  const [bulan, setBulan] = useState<string>('Semua');
  const [jenisKeuangan, setJenisKeuangan] = useState<string>('Semua');
  const [kategoriSantri, setKategoriSantri] = useState<string>('Semua');
  const [statusSantri, setStatusSantri] = useState<string>('Semua');
  const [statusPendaftaran, setStatusPendaftaran] = useState<string>('Semua');
  const [filterIuran, setFilterIuran] = useState<string>('Semua');
  const [masterIuranList, setMasterIuranList] = useState<MasterIuran[]>([]);

  // Data States
  const [isLoading, setIsLoading] = useState(true);
  const [keuanganData, setKeuanganData] = useState<LaporanKeuanganData | null>(null);
  const [santriData, setSantriData] = useState<Santri[]>([]);
  const [pendaftaranData, setPendaftaranData] = useState<Pendaftaran[]>([]);
  const [syahriyahData, setSyahriyahData] = useState<LaporanSyahriyahRow[]>([]);
  const [iuranData, setIuranData] = useState<LaporanIuranRow[]>([]);
  const [kilatanData, setKilatanData] = useState<LaporanKilatanRow[]>([]);

  // Print & PDF Preview Modal States
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewPdfUrl, setPreviewPdfUrl] = useState<string | null>(null);
  const [previewParams, setPreviewParams] = useState<ExportLaporanPdfParams | null>(null);

  const loadActiveTabData = async () => {
    setIsLoading(true);
    try {
      if (activeTab === 'keuangan') {
        const res = await laporanService.getLaporanKeuangan(tahun, bulan, jenisKeuangan);
        setKeuanganData(res);
      } else if (activeTab === 'santri') {
        const res = await laporanService.getLaporanSantri(kategoriSantri, statusSantri);
        setSantriData(res);
      } else if (activeTab === 'pendaftaran') {
        const res = await laporanService.getLaporanPendaftaran(tahun, bulan, statusPendaftaran);
        setPendaftaranData(res);
      } else if (activeTab === 'syahriyah') {
        const res = await laporanService.getLaporanSyahriyah(tahun, kategoriSantri);
        setSyahriyahData(res);
      } else if (activeTab === 'iuran') {
        const res = await laporanService.getLaporanIuran(tahun, filterIuran);
        setIuranData(res);
        setMasterIuranList(await masterIuranService.getAktif());
      } else if (activeTab === 'kilatan') {
        const res = await laporanService.getLaporanKilatan(tahun);
        setKilatanData(res);
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadActiveTabData();
  }, [activeTab, tahun, bulan, jenisKeuangan, kategoriSantri, statusSantri, statusPendaftaran, filterIuran]);

  const handleResetFilter = () => {
    setTahun(currentYear);
    setBulan('Semua');
    setJenisKeuangan('Semua');
    setKategoriSantri('Semua');
    setStatusSantri('Semua');
    setStatusPendaftaran('Semua');
    setFilterIuran('Semua');
  };

  // Helper to generate payload (including TOTAL summary row) for exports
  const getCurrentExportPayload = () => {
    const bulanLabel = BULAN_OPTIONS.find((b) => b.value === bulan)?.label || bulan;

    if (activeTab === 'keuangan') {
      const filenameBase = `Laporan-Keuangan-${bulanLabel}-${tahun}`;
      if (!keuanganData || keuanganData.list.length === 0) {
        return { filenameBase, data: [], sheetName: 'Keuangan' };
      }

      const data: Record<string, any>[] = keuanganData.list.map((k) => ({
        Tanggal: k.tanggal,
        Kategori: k.kategori_nama,
        Keterangan: k.keterangan || '-',
        Jenis: k.jenis,
        'Nominal (Rp)': k.nominal,
      }));

      data.push({
        Tanggal: 'TOTAL KESELURUHAN',
        Kategori: `${keuanganData.list.length} Transaksi`,
        Keterangan: `Pemasukan: ${formatRupiah(keuanganData.totalPemasukan)} | Pengeluaran: ${formatRupiah(keuanganData.totalPengeluaran)}`,
        Jenis: 'Saldo Bersih',
        'Nominal (Rp)': keuanganData.saldoBersih,
      });

      return { filenameBase, data, sheetName: 'Keuangan' };
    }

    if (activeTab === 'santri') {
      const filenameBase = `Data-Santri-${tahun}`;
      if (santriData.length === 0) {
        return { filenameBase, data: [], sheetName: 'Data Santri' };
      }

      const data: Record<string, any>[] = santriData.map((s) => ({
        NIS: s.nis,
        'Nama Santri': s.nama,
        Kategori: s.kategori,
        Status: s.status,
        'Nama Wali': s.nama_wali,
        'No HP Santri': s.no_hp_santri,
        'No HP Wali': s.no_hp_wali,
        'Tanggal Masuk': s.tanggal_masuk || '-',
      }));

      data.push({
        NIS: 'TOTAL SANTRI',
        'Nama Santri': `${santriData.length} Santri`,
        Kategori: '',
        Status: `${santriData.filter((s) => s.status === 'Aktif').length} Aktif`,
        'Nama Wali': '',
        'No HP Santri': '',
        'No HP Wali': '',
        'Tanggal Masuk': '',
      });

      return { filenameBase, data, sheetName: 'Data Santri' };
    }

    if (activeTab === 'pendaftaran') {
      const filenameBase = `Laporan-Pendaftaran-${bulanLabel}-${tahun}`;
      if (pendaftaranData.length === 0) {
        return { filenameBase, data: [], sheetName: 'Pendaftaran' };
      }

      const data: Record<string, any>[] = pendaftaranData.map((p) => ({
        'Tanggal Daftar': p.tanggal_pendaftaran,
        'Nama Calon': p.nama_calon,
        'Nama Wali': p.nama_wali,
        'No HP Santri': p.no_hp_santri,
        'No HP Wali': p.no_hp_wali,
        Kategori: p.kategori,
        Status: p.status,
      }));

      data.push({
        'Tanggal Daftar': 'TOTAL PENDAFTAR',
        'Nama Calon': `${pendaftaranData.length} Pendaftar`,
        'Nama Wali': '',
        'No HP Santri': '',
        'No HP Wali': '',
        Kategori: '',
        Status: '',
      });

      return { filenameBase, data, sheetName: 'Pendaftaran' };
    }

    // activeTab === 'iuran'
    if (activeTab === 'iuran') {
      const filenameBase = `Rekap-Iuran-${tahun}`;
      if (iuranData.length === 0) {
        return { filenameBase, data: [], sheetName: 'Iuran' };
      }

      const data: Record<string, any>[] = iuranData.map((r) => ({
        'Program Iuran': r.iuranNama,
        'Jenis Periode': labelPeriodeIuran(r.jenisPeriode),
        'Nominal Tagihan (Rp)': r.nominalTagihan,
        'Total Pembayaran (Rp)': r.totalPembayaran,
        'Sisa Tagihan (Rp)': r.sisaTagihan,
        Status: r.status,
      }));

      data.push({
        'Program Iuran': 'TOTAL',
        'Jenis Periode': '',
        'Nominal Tagihan (Rp)': iuranData.reduce((sum, r) => sum + r.nominalTagihan, 0),
        'Total Pembayaran (Rp)': iuranData.reduce((sum, r) => sum + r.totalPembayaran, 0),
        'Sisa Tagihan (Rp)': iuranData.reduce((sum, r) => sum + r.sisaTagihan, 0),
        Status: '',
      });

      return { filenameBase, data, sheetName: 'Iuran' };
    }

    // activeTab === 'kilatan'
    if (activeTab === 'kilatan') {
      const filenameBase = `Rekap-Kilatan-${tahun}`;
      if (kilatanData.length === 0) {
        return { filenameBase, data: [], sheetName: 'Kilatan' };
      }

      const data: Record<string, any>[] = kilatanData.map((r) => ({
        Event: r.event,
        'Total Tagihan (1 Tahun)': r.totalTagihan,
        'Total Dibayar': r.totalDibayar,
        'Sisa Tunggakan': r.sisaTunggakan,
        Status: r.status,
      }));

      data.push({
        Event: 'TOTAL',
        'Total Tagihan (1 Tahun)': kilatanData.reduce((sum, r) => sum + r.totalTagihan, 0),
        'Total Dibayar': kilatanData.reduce((sum, r) => sum + r.totalDibayar, 0),
        'Sisa Tunggakan': kilatanData.reduce((sum, r) => sum + r.sisaTunggakan, 0),
        Status: '',
      });

      return { filenameBase, data, sheetName: 'Kilatan' };
    }

    // activeTab === 'syahriyah'
    const filenameBase = `Rekap-Syahriyah-${tahun}`;
    if (syahriyahData.length === 0) {
      return { filenameBase, data: [], sheetName: 'Syahriyah' };
    }

    const data: Record<string, any>[] = syahriyahData.map((r) => ({
      NIS: r.nis,
      'Nama Santri': r.nama,
      Kategori: r.kategori,
      'Total Tagihan (1 Thn)': r.totalTagihan,
      'Total Dibayar': r.totalDibayar,
      'Sisa Tunggakan': r.sisaTunggakan,
      Status: r.statusTahunan,
    }));

    const sumTagihan = syahriyahData.reduce((sum, r) => sum + r.totalTagihan, 0);
    const sumDibayar = syahriyahData.reduce((sum, r) => sum + r.totalDibayar, 0);
    const sumTunggakan = syahriyahData.reduce((sum, r) => sum + r.sisaTunggakan, 0);

    data.push({
      NIS: 'TOTAL',
      'Nama Santri': `${syahriyahData.length} Santri`,
      Kategori: '',
      'Total Tagihan (1 Thn)': sumTagihan,
      'Total Dibayar': sumDibayar,
      'Sisa Tunggakan': sumTunggakan,
      Status: '',
    });

    return { filenameBase, data, sheetName: 'Syahriyah' };
  };

  const handleExportCsv = () => {
    const { filenameBase, data } = getCurrentExportPayload();
    exportToCsv(`${filenameBase}.csv`, data);
  };

  const handleExportExcel = () => {
    const { filenameBase, data, sheetName } = getCurrentExportPayload();
    exportToExcel(`${filenameBase}.xlsx`, data, sheetName);
  };

  const getCurrentPdfParams = (): ExportLaporanPdfParams | null => {
    const bulanLabel = BULAN_OPTIONS.find((b) => b.value === bulan)?.label || bulan;

    if (activeTab === 'keuangan') {
      if (!keuanganData || keuanganData.list.length === 0) {
        showToast('Tidak ada data transaksi kas untuk diekspor', 'error');
        return null;
      }

      return {
        title: 'Laporan Rekapitulasi Keuangan Kas',
        subtitle: `Periode: ${bulanLabel} ${tahun}`,
        filename: `Laporan-Keuangan-${bulanLabel}-${tahun}`,
        orientation: 'portrait',
        filterInfo: [
          { label: 'Tahun', value: String(tahun) },
          { label: 'Bulan', value: bulanLabel },
          { label: 'Jenis', value: jenisKeuangan },
        ],
        summaryMetrics: [
          { label: 'TOTAL PEMASUKAN', value: formatRupiah(keuanganData.totalPemasukan) },
          { label: 'TOTAL PENGELUARAN', value: formatRupiah(keuanganData.totalPengeluaran) },
          { label: 'SALDO BERSIH', value: formatSaldo(keuanganData.saldoBersih) },
          { label: 'TOTAL TRANSAKSI', value: `${keuanganData.list.length} Data` },
        ],
        headers: ['No', 'Tanggal', 'Kategori', 'Keterangan', 'Jenis', 'Nominal'],
        rows: keuanganData.list.map((k, idx) => [
          idx + 1,
          k.tanggal,
          k.kategori_nama,
          k.keterangan || '-',
          k.jenis,
          `${k.jenis === 'Pemasukan' ? '+' : '-'} ${formatRupiah(k.nominal)}`,
        ]),
        footers: [
          [
            '',
            '',
            `TOTAL (${keuanganData.list.length} Transaksi)`,
            `Masuk: ${formatRupiah(keuanganData.totalPemasukan)} | Keluar: ${formatRupiah(keuanganData.totalPengeluaran)}`,
            'Saldo Bersih',
            formatSaldo(keuanganData.saldoBersih),
          ],
        ],
        columnStyles: {
          0: { cellWidth: 10, halign: 'center' },
          1: { cellWidth: 22, halign: 'center' },
          2: { cellWidth: 35 },
          3: { cellWidth: 'auto' },
          4: { cellWidth: 22, halign: 'center' },
          5: { cellWidth: 32, halign: 'right' },
        },
      };
    }

    if (activeTab === 'santri') {
      if (santriData.length === 0) {
        showToast('Tidak ada data santri untuk diekspor', 'error');
        return null;
      }

      const aktifCount = santriData.filter((s) => s.status === 'Aktif').length;
      const nonaktifCount = santriData.length - aktifCount;

      return {
        title: 'Laporan Master Data Santri',
        subtitle: `Tahun Akademik: ${tahun}`,
        filename: `Data-Santri-${tahun}`,
        orientation: 'landscape',
        filterInfo: [
          { label: 'Kategori', value: kategoriSantri },
          { label: 'Status', value: statusSantri },
        ],
        summaryMetrics: [
          { label: 'TOTAL SANTRI', value: `${santriData.length} Santri` },
          { label: 'SANTRI AKTIF', value: `${aktifCount} Santri` },
          { label: 'SANTRI TIDAK AKTIF', value: `${nonaktifCount} Santri` },
        ],
        headers: ['No', 'NIS', 'Nama Santri', 'Kategori', 'Status', 'Nama Wali', 'No HP Wali', 'Tanggal Masuk'],
        rows: santriData.map((s, idx) => [
          idx + 1,
          s.nis,
          s.nama,
          s.kategori,
          s.status,
          s.nama_wali || '-',
          s.no_hp_wali || s.no_hp_santri || '-',
          s.tanggal_masuk || '-',
        ]),
        footers: [
          [
            '',
            '',
            `TOTAL: ${santriData.length} Santri`,
            '',
            `${aktifCount} Aktif / ${nonaktifCount} Nonaktif`,
            '',
            '',
            '',
          ],
        ],
        columnStyles: {
          0: { cellWidth: 10, halign: 'center' },
          1: { cellWidth: 24, halign: 'center' },
          2: { cellWidth: 50 },
          3: { cellWidth: 24, halign: 'center' },
          4: { cellWidth: 24, halign: 'center' },
          5: { cellWidth: 45 },
          6: { cellWidth: 35, halign: 'center' },
          7: { cellWidth: 30, halign: 'center' },
        },
      };
    }

    if (activeTab === 'pendaftaran') {
      if (pendaftaranData.length === 0) {
        showToast('Tidak ada data pendaftaran untuk diekspor', 'error');
        return null;
      }

      const baruCount = pendaftaranData.filter((p) => p.status === 'Baru').length;
      const diterimaCount = pendaftaranData.filter((p) => p.status === 'Diterima').length;
      const santriCount = pendaftaranData.filter((p) => p.status === 'Menjadi Santri').length;

      return {
        title: 'Laporan Pendaftaran Santri Baru',
        subtitle: `Periode: ${bulanLabel} ${tahun}`,
        filename: `Laporan-Pendaftaran-${bulanLabel}-${tahun}`,
        orientation: 'landscape',
        filterInfo: [
          { label: 'Tahun', value: String(tahun) },
          { label: 'Bulan', value: bulanLabel },
          { label: 'Status', value: statusPendaftaran },
        ],
        summaryMetrics: [
          { label: 'TOTAL PENDAFTAR', value: `${pendaftaranData.length} Calon` },
          { label: 'STATUS BARU', value: `${baruCount} Calon` },
          { label: 'DITERIMA', value: `${diterimaCount} Calon` },
          { label: 'MENJADI SANTRI', value: `${santriCount} Calon` },
        ],
        headers: ['No', 'Tgl Daftar', 'Nama Calon', 'Nama Wali', 'No HP Calon / Wali', 'Kategori', 'Status'],
        rows: pendaftaranData.map((p, idx) => [
          idx + 1,
          p.tanggal_pendaftaran,
          p.nama_calon,
          p.nama_wali || '-',
          p.no_hp_santri || p.no_hp_wali || '-',
          p.kategori,
          p.status,
        ]),
        footers: [
          [
            '',
            '',
            `TOTAL: ${pendaftaranData.length} Pendaftar`,
            '',
            '',
            '',
            `${diterimaCount + santriCount} Lolos`,
          ],
        ],
        columnStyles: {
          0: { cellWidth: 10, halign: 'center' },
          1: { cellWidth: 30, halign: 'center' },
          2: { cellWidth: 55 },
          3: { cellWidth: 50 },
          4: { cellWidth: 40, halign: 'center' },
          5: { cellWidth: 28, halign: 'center' },
          6: { cellWidth: 35, halign: 'center' },
        },
      };
    }

    if (activeTab === 'iuran') {
      if (iuranData.length === 0) {
        showToast('Tidak ada data rekap iuran untuk diekspor', 'error');
        return null;
      }

      const sumIuranTagihan = iuranData.reduce((sum, r) => sum + r.nominalTagihan, 0);
      const sumIuranPembayaran = iuranData.reduce((sum, r) => sum + r.totalPembayaran, 0);
      const sumIuranSisa = iuranData.reduce((sum, r) => sum + r.sisaTagihan, 0);
      const lunasIuranCount = iuranData.filter((r) => r.status === 'Lunas').length;

      return {
        title: 'Laporan Rekapitulasi Iuran',
        subtitle: `Tahun: ${tahun}`,
        filename: `Rekap-Iuran-${tahun}`,
        orientation: 'landscape',
        filterInfo: [
          { label: 'Tahun', value: String(tahun) },
        ],
        summaryMetrics: [
          { label: 'TOTAL PROGRAM IURAN', value: `${iuranData.length} Program` },
          { label: 'TOTAL TAGIHAN (1 PERIODE)', value: formatRupiah(sumIuranTagihan) },
          { label: 'TOTAL PEMBAYARAN IURAN', value: formatRupiah(sumIuranPembayaran) },
          { label: 'SISA TAGIHAN', value: formatRupiah(sumIuranSisa) },
        ],
        headers: ['No', 'Program Iuran', 'Jenis Periode', 'Nominal Tagihan', 'Total Pembayaran', 'Sisa Tagihan', 'Status'],
        rows: iuranData.map((r, idx) => [
          idx + 1,
          r.iuranNama,
          labelPeriodeIuran(r.jenisPeriode),
          formatRupiah(r.nominalTagihan),
          formatRupiah(r.totalPembayaran),
          formatRupiah(r.sisaTagihan),
          r.status,
        ]),
        footers: [
          [
            '',
            '',
            `TOTAL (${iuranData.length} Program)`,
            formatRupiah(sumIuranTagihan),
            formatRupiah(sumIuranPembayaran),
            formatRupiah(sumIuranSisa),
            `${lunasIuranCount} Lunas`,
          ],
        ],
        columnStyles: {
          0: { cellWidth: 10, halign: 'center' },
          1: { cellWidth: 45 },
          2: { cellWidth: 20, halign: 'center' },
          3: { cellWidth: 30, halign: 'right' },
          4: { cellWidth: 30, halign: 'right' },
          5: { cellWidth: 30, halign: 'right' },
          6: { cellWidth: 20, halign: 'center' },
        },
      };
    }

    if (activeTab === 'kilatan') {
      if (kilatanData.length === 0) {
        showToast('Tidak ada data rekap kilatan untuk diekspor', 'error');
        return null;
      }

      const sumKilatanTagihan = kilatanData.reduce((sum, r) => sum + r.totalTagihan, 0);
      const sumKilatanDibayar = kilatanData.reduce((sum, r) => sum + r.totalDibayar, 0);
      const sumKilatanSisa = kilatanData.reduce((sum, r) => sum + r.sisaTunggakan, 0);
      const lunasKilatanCount = kilatanData.filter((r) => r.status === 'Lunas').length;

      return {
        title: 'Laporan Rekapitulasi Kilatan',
        subtitle: `Tahun: ${tahun}`,
        filename: `Rekap-Kilatan-${tahun}`,
        orientation: 'landscape',
        filterInfo: [
          { label: 'Tahun', value: String(tahun) },
        ],
        summaryMetrics: [
          { label: 'TOTAL EVENT KILATAN', value: `${kilatanData.length} Event` },
          { label: 'TOTAL TAGIHAN', value: formatRupiah(sumKilatanTagihan) },
          { label: 'TOTAL DIBAYAR', value: formatRupiah(sumKilatanDibayar) },
          { label: 'SISA TUNGGAKAN', value: formatRupiah(sumKilatanSisa) },
        ],
        headers: ['No', 'Event', 'Total Tagihan', 'Total Dibayar', 'Sisa Tunggakan', 'Status'],
        rows: kilatanData.map((r, idx) => [
          idx + 1,
          r.event,
          formatRupiah(r.totalTagihan),
          formatRupiah(r.totalDibayar),
          formatRupiah(r.sisaTunggakan),
          r.status,
        ]),
        footers: [
          [
            '',
            '',
            `TOTAL (${kilatanData.length} Event)`,
            formatRupiah(sumKilatanTagihan),
            formatRupiah(sumKilatanDibayar),
            formatRupiah(sumKilatanSisa),
            `${lunasKilatanCount} Lunas`,
          ],
        ],
        columnStyles: {
          0: { cellWidth: 10, halign: 'center' },
          1: { cellWidth: 40 },
          2: { cellWidth: 30, halign: 'right' },
          3: { cellWidth: 30, halign: 'right' },
          4: { cellWidth: 30, halign: 'right' },
          5: { cellWidth: 20, halign: 'center' },
        },
      };
    }

    // activeTab === 'syahriyah'
    if (syahriyahData.length === 0) {
      showToast('Tidak ada data rekap syahriyah untuk diekspor', 'error');
      return null;
    }

    const sumTagihan = syahriyahData.reduce((sum, r) => sum + r.totalTagihan, 0);
    const sumDibayar = syahriyahData.reduce((sum, r) => sum + r.totalDibayar, 0);
    const sumTunggakan = syahriyahData.reduce((sum, r) => sum + r.sisaTunggakan, 0);
    const lunasCount = syahriyahData.filter((r) => r.statusTahunan === 'Lunas').length;

    return {
      title: 'Laporan Tahunan Syahriyah Santri',
      subtitle: `Tahun: ${tahun}`,
      filename: `Rekap-Syahriyah-${tahun}`,
      orientation: 'landscape',
      filterInfo: [
        { label: 'Tahun', value: String(tahun) },
        { label: 'Kategori Santri', value: kategoriSantri },
      ],
      summaryMetrics: [
        { label: 'TOTAL SANTRI', value: `${syahriyahData.length} Santri` },
        { label: 'TOTAL TAGIHAN (1 THN)', value: formatRupiah(sumTagihan) },
        { label: 'TOTAL TERBAYAR', value: formatRupiah(sumDibayar) },
        { label: 'SISA TUNGGAKAN', value: formatRupiah(sumTunggakan) },
      ],
      headers: ['No', 'NIS', 'Nama Santri', 'Kategori', 'Tagihan 1 Thn', 'Total Dibayar', 'Sisa Tunggakan', 'Status'],
      rows: syahriyahData.map((r, idx) => [
        idx + 1,
        r.nis,
        r.nama,
        r.kategori,
        formatRupiah(r.totalTagihan),
        formatRupiah(r.totalDibayar),
        formatRupiah(r.sisaTunggakan),
        r.statusTahunan,
      ]),
      footers: [
        [
          '',
          '',
          `TOTAL (${syahriyahData.length} Santri)`,
          '',
          formatRupiah(sumTagihan),
          formatRupiah(sumDibayar),
          formatRupiah(sumTunggakan),
          `${lunasCount} Lunas`,
        ],
      ],
      columnStyles: {
        0: { cellWidth: 10, halign: 'center' },
        1: { cellWidth: 25, halign: 'center' },
        2: { cellWidth: 55 },
        3: { cellWidth: 26, halign: 'center' },
        4: { cellWidth: 35, halign: 'right' },
        5: { cellWidth: 35, halign: 'right' },
        6: { cellWidth: 35, halign: 'right' },
        7: { cellWidth: 25, halign: 'center' },
      },
    };
  };

  const handleExportPdf = () => {
    const params = getCurrentPdfParams();
    if (params) {
      exportLaporanToPdf(params);
    }
  };

  const handleOpenPrintPreview = async () => {
    const params = getCurrentPdfParams();
    if (!params) return;

    const url = await generateLaporanPdfBlobUrl(params);
    if (url) {
      setPreviewPdfUrl(url);
      setPreviewParams(params);
      setPreviewModalOpen(true);
    }
  };

  const handleClosePreviewModal = () => {
    if (previewPdfUrl) {
      URL.revokeObjectURL(previewPdfUrl);
    }
    setPreviewPdfUrl(null);
    setPreviewParams(null);
    setPreviewModalOpen(false);
  };

  const tabButton = (icon: React.ReactElement, label: string, value: TabType) => (
    <button
      key={value}
      onClick={() => setActiveTab(value)}
      className={`py-3 text-xs font-semibold border-b-2 whitespace-nowrap transition-colors flex items-center gap-2 ${
        activeTab === value
          ? 'border-[#059669] text-[#059669]'
          : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );

  const exportButtons = () => (
    <div className="flex gap-2">
      <button
        onClick={handleExportCsv}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
      >
        <Download className="w-3 h-3" />
        <span>Export CSV</span>
      </button>
      <button
        onClick={handleExportExcel}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors"
      >
        <FileText className="w-3 h-3" />
        <span>Export Excel</span>
      </button>
      <button
        onClick={handleExportPdf}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors"
      >
        <Download className="w-3 h-3" />
        <span>Unduh PDF</span>
      </button>
      <button
        onClick={handleOpenPrintPreview}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white bg-slate-800 hover:bg-slate-900 rounded-lg transition-colors"
      >
        <Printer className="w-3 h-3" />
        <span>Cetak / Pratinjau</span>
      </button>
    </div>
  );

  const sectionBar = () => (
    <div className="flex items-center justify-between gap-4 mb-4">
      <div>
        <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
          {sectionTitles[activeTab]}
        </h4>
      </div>
      <div className="flex gap-2">{exportButtons()}</div>
    </div>
  );

  const summaryCard = (label: string, value: string, color: 'emerald' | 'rose' | 'blue') => {
    const theme: Record<string, { bg: string; border: string; text: string }> = {
      emerald: { bg: 'bg-emerald-50', border: 'border-emerald-100', text: 'text-emerald-700' },
      rose: { bg: 'bg-rose-50', border: 'border-rose-100', text: 'text-rose-600' },
      blue: { bg: 'bg-blue-50', border: 'border-blue-100', text: 'text-blue-600' },
    };
    const t = theme[color];
    return (
      <div className={`${t.bg} ${t.border} p-4 rounded-xl`}>
        <p className="text-[11px] font-bold uppercase text-slate-500 mb-1">{label}</p>
        <p className={`text-xl font-bold ${t.text}`}>{value}</p>
      </div>
    );
  };

  const jenisBadge = (jenis: string) => {
    const isMasuk = jenis === 'Pemasukan';
    return (
      <span className={`px-2.5 py-0.5 rounded text-[10px] font-semibold capitalize ${
        isMasuk
          ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
          : 'bg-rose-100 text-rose-600 border border-rose-200'
      }`}>
        {jenis}
      </span>
    );
  };

  const statusBadge = (status: string) => {
    const themes: Record<string, { bg: string; text: string; border: string }> = {
      Lunas: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
      Sebagian: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
      Belum: { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200' },
    };
    const t = themes[status] || themes.Belum;
    return (
      <span className={`px-2.5 py-0.5 rounded text-[10px] font-semibold capitalize ${t.bg} ${t.text} ${t.border}`}>
        {status}
      </span>
    );
  };

  return (
    <div className="space-y-6 pb-12">

      {/* Header Halaman */}
      <div className="flex flex-col">
        <h1 className="text-2xl font-bold text-[#0F172A] tracking-tight">
          Laporan & Rekapitulasi
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Analisis rekapitulasi data pondok dan unduh laporan PDF / Excel / CSV
        </p>
      </div>

      {/* Navigation Tabs (Garis Bawah Style) */}
      <div className="border-b border-slate-200">
        <nav className="flex space-x-8 overflow-x-auto no-scrollbar">
          {tabButton(<Wallet className="w-4 h-4" />, 'Rekap Keuangan', 'keuangan')}
          {tabButton(<Users className="w-4 h-4" />, 'Data Santri', 'santri')}
          {tabButton(<UserPlus className="w-4 h-4" />, 'Pendaftaran', 'pendaftaran')}
          {tabButton(<CreditCard className="w-4 h-4" />, 'Rekap Syahriyah', 'syahriyah')}
          {tabButton(<HandCoins className="w-4 h-4" />, 'Rekap Iuran', 'iuran')}
          {tabButton(<CalendarDays className="w-4 h-4" />, 'Rekap Kilatan', 'kilatan')}
        </nav>
      </div>

      {/* Area Filter Responsive (Card Putih) */}
      <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 shadow-xs space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <Filter className="w-4 h-4 text-[#059669]" />
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
            Filter Laporan
          </h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-center">
          {/* Tahun Filter (All Tabs) */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Tahun</label>
            <select
              value={tahun}
              onChange={(e) => setTahun(Number(e.target.value))}
              className="block w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
            >
              {[currentYear - 2, currentYear - 1, currentYear, currentYear + 1].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          {activeTab === 'keuangan' && (
            <>
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">Bulan</label>
                <select
                  value={bulan}
                  onChange={(e) => setBulan(e.target.value)}
                  className="block w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                >
                  {BULAN_OPTIONS.map((b) => (
                    <option key={b.value} value={b.value}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">Jenis Transaksi</label>
                <select
                  value={jenisKeuangan}
                  onChange={(e) => setJenisKeuangan(e.target.value)}
                  className="block w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                >
                  <option value="Semua">Semua Jenis</option>
                  <option value="Pemasukan">Pemasukan</option>
                  <option value="Pengeluaran">Pengeluaran</option>
                </select>
              </div>
            </>
          )}

          {activeTab === 'santri' && (
            <>
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">Kategori</label>
                <select
                  value={kategoriSantri}
                  onChange={(e) => setKategoriSantri(e.target.value)}
                  className="block w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                >
                  <option value="Semua">Semua</option>
                  <option value="Yatim">Yatim</option>
                  <option value="Dhuafa">Dhuafa</option>
                  <option value="Umum">Umum</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">Status</label>
                <select
                  value={statusSantri}
                  onChange={(e) => setStatusSantri(e.target.value)}
                  className="block w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                >
                  <option value="Semua">Semua</option>
                  <option value="Aktif">Aktif</option>
                  <option value="Nonaktif">Nonaktif</option>
                </select>
              </div>
            </>
          )}

          {activeTab === 'pendaftaran' && (
            <>
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">Bulan</label>
                <select
                  value={bulan}
                  onChange={(e) => setBulan(e.target.value)}
                  className="block w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                >
                  {BULAN_OPTIONS.map((b) => (
                    <option key={b.value} value={b.value}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">Status</label>
                <select
                  value={statusPendaftaran}
                  onChange={(e) => setStatusPendaftaran(e.target.value)}
                  className="block w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                >
                  <option value="Semua">Semua</option>
                  <option value="Baru">Baru</option>
                  <option value="Diterima">Diterima</option>
                  <option value="Menjadi Santri">Menjadi Santri</option>
                  <option value="Ditolak">Ditolak</option>
                </select>
              </div>
            </>
          )}

          {activeTab === 'syahriyah' && (
            <>
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">Kategori Santri</label>
                <select
                  value={kategoriSantri}
                  onChange={(e) => setKategoriSantri(e.target.value)}
                  className="block w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                >
                  <option value="Semua">Semua</option>
                  <option value="Yatim">Yatim</option>
                  <option value="Dhuafa">Dhuafa</option>
                  <option value="Umum">Umum</option>
                </select>
              </div>
            </>
          )}

          {activeTab === 'iuran' && (
            <>
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">Program Iuran</label>
                <select
                  value={filterIuran}
                  onChange={(e) => setFilterIuran(e.target.value)}
                  className="block w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                >
                  <option value="Semua">Semua Program</option>
                  {masterIuranList.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nama}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {(activeTab === 'santri' || activeTab === 'pendaftaran' || activeTab === 'syahriyah' || activeTab === 'iuran') && (
            <div className="flex items-end">
              <button
                onClick={handleResetFilter}
                className="px-3 py-2 text-xs text-slate-600 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors"
              >
                Reset
              </button>
            </div>
          )}

          {activeTab === 'kilatan' && (
            <>
              <div className="flex items-end">
                <button onClick={handleResetFilter} className="px-3 py-2 text-xs text-slate-600 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors">
                  Reset
                </button>
              </div>
            </>
          )}

          {/* Reset button for keuangan shown after filters */}
          {activeTab === 'keuangan' && (
            <div className="flex items-end">
              <button onClick={handleResetFilter} className="px-3 py-2 text-xs text-slate-600 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors">
                Reset
              </button>
            </div>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-slate-500">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-emerald-600"></div>
          <span className="ml-2">Memuat laporan...</span>
        </div>
      ) : null}

      {/* Konten per Tab */}
      {activeTab === 'keuangan' && (
        <div className="overflow-x-auto">
          {sectionBar()}
          {keuanganData ? (
            <>
              {/* Kartu Ringkasan */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                {summaryCard(
                  'Total Pemasukan',
                  `Rp ${keuanganData.totalPemasukan.toLocaleString('id-ID')}`,
                  'emerald'
                )}
                {summaryCard(
                  'Total Pengeluaran',
                  `Rp ${keuanganData.totalPengeluaran.toLocaleString('id-ID')}`,
                  'rose'
                )}
                {summaryCard(
                  'Saldo Bersih',
                  `Rp ${keuanganData.saldoBersih.toLocaleString('id-ID')}`,
                  'blue'
                )}
              </div>

              {/* Tabel Transaksi */}
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Tanggal</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Kategori</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Keterangan</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Jenis</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Nominal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {keuanganData.list.map((k) => (
                    <tr key={k.tanggal + k.keterangan}>
                      <td className="px-4 py-3 text-slate-700">{k.tanggal}</td>
                      <td className="px-4 py-3 text-slate-700 capitalize">{k.kategori_nama}</td>
                      <td className="px-4 py-3 text-slate-700">{k.keterangan || '-'}</td>
                      <td className="px-4 py-3">{jenisBadge(k.jenis)}</td>
                      <td className={`px-4 py-3 text-slate-700 text-right font-mono ${
                        k.jenis === 'Pemasukan' ? 'text-emerald-600' : 'text-rose-600'
                      }`}>
                        {k.jenis === 'Pemasukan' ? '+' : '−'} Rp {k.nominal.toLocaleString('id-ID')}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-100 font-bold text-slate-800 border-t-2 border-slate-300">
                  <tr>
                    <td colSpan={3} className="px-4 py-3 text-left uppercase">
                      TOTAL ({keuanganData.list.length} Transaksi)
                    </td>
                    <td className="px-4 py-3"></td>
                    <td className="px-4 py-3 text-right font-mono">
                      {`Masuk: Rp ${keuanganData.totalPemasukan.toLocaleString('id-ID')} | Keluar: Rp ${keuanganData.totalPengeluaran.toLocaleString('id-ID')}`}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </>
          ) : null}
        </div>
      )}

      {activeTab === 'santri' && (
        <div className="overflow-x-auto">
          {sectionBar()}
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">NIS</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Nama Santri</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Kategori</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Status</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Nama Wali</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">No HP Wali</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Tgl Masuk</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {santriData.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-3 text-slate-700 font-mono">{s.nis}</td>
                  <td className="px-4 py-3 text-slate-700">{s.nama}</td>
                  <td className="px-4 py-3 text-slate-700 capitalize">{s.kategori}</td>
                  <td className="px-4 py-3 text-slate-700 capitalize">{statusBadge(s.status)}</td>
                  <td className="px-4 py-3 text-slate-700">{s.nama_wali || '-'}</td>
                  <td className="px-4 py-3 text-slate-700 font-mono">{s.no_hp_wali || s.no_hp_santri || '-'}</td>
                  <td className="px-4 py-3 text-slate-700">{s.tanggal_masuk || '-'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-100 font-bold text-slate-800 border-t-2 border-slate-300">
              <tr>
                <td colSpan={2} className="px-4 py-3 text-left uppercase">
                  TOTAL ({santriData.length} Santri)
                </td>
                <td className="px-4 py-3"></td>
                <td className="px-4 py-3 text-right font-mono text-emerald-700">
                  {santriData.filter((s) => s.status === 'Aktif').length} Aktif
                </td>
                <td className="px-4 py-3"></td>
                <td className="px-4 py-3"></td>
                <td className="px-4 py-3"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {activeTab === 'pendaftaran' && (
        <div className="overflow-x-auto">
          {sectionBar()}
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Tgl Daftar</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Nama Calon</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Nama Wali</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">No HP</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Kategori</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pendaftaranData.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-3 text-slate-700">{p.tanggal_pendaftaran}</td>
                  <td className="px-4 py-3 text-slate-700">{p.nama_calon}</td>
                  <td className="px-4 py-3 text-slate-700">{p.nama_wali || '-'}</td>
                  <td className="px-4 py-3 text-slate-700 font-mono">{p.no_hp_santri || p.no_hp_wali || '-'}</td>
                  <td className="px-4 py-3 text-slate-700 capitalize">{p.kategori}</td>
                  <td className="px-4 py-3 text-slate-700 capitalize">{statusBadge(p.status)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-100 font-bold text-slate-800 border-t-2 border-slate-300">
              <tr>
                <td colSpan={2} className="px-4 py-3 text-left uppercase">
                  TOTAL ({pendaftaranData.length} Pendaftar)
                </td>
                <td className="px-4 py-3"></td>
                <td className="px-4 py-3"></td>
                <td className="px-4 py-3"></td>
                <td className="px-4 py-3 text-right font-mono text-emerald-700">
                  {pendaftaranData.filter((p) => p.status === 'Diterima' || p.status === 'Menjadi Santri').length} Lolos
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {activeTab === 'syahriyah' && (
        <div className="overflow-x-auto">
          {sectionBar()}
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">NIS</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Nama Santri</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Kategori</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Tagihan 1 Thn</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Total Dibayar</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Sisa Tunggakan</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {syahriyahData.map((r) => (
                <tr key={r.nis}>
                  <td className="px-4 py-3 text-slate-700 font-mono">{r.nis}</td>
                  <td className="px-4 py-3 text-slate-700">{r.nama}</td>
                  <td className="px-4 py-3 text-slate-700 capitalize">{r.kategori}</td>
                  <td className="px-4 py-3 text-slate-700 text-right font-mono">{formatRupiah(r.totalTagihan)}</td>
                  <td className="px-4 py-3 text-slate-700 text-right font-mono text-emerald-700">{formatRupiah(r.totalDibayar)}</td>
                  <td className="px-4 py-3 text-slate-700 text-right font-mono text-rose-600">{formatRupiah(r.sisaTunggakan)}</td>
                  <td className="px-4 py-3 text-slate-700">{statusBadge(r.statusTahunan)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-100 font-bold text-slate-800 border-t-2 border-slate-300">
              <tr>
                <td colSpan={3} className="px-4 py-3 text-left uppercase">
                  TOTAL ({syahriyahData.length} Santri)
                </td>
                <td className="px-4 py-3"></td>
                <td className="px-4 py-3 text-right font-mono">{formatRupiah(syahriyahData.reduce((s, r) => s + r.totalTagihan, 0))}</td>
                <td className="px-4 py-3 text-right font-mono text-emerald-700">{formatRupiah(syahriyahData.reduce((s, r) => s + r.totalDibayar, 0))}</td>
                <td className="px-4 py-3 text-right font-mono text-rose-600">{formatRupiah(syahriyahData.reduce((s, r) => s + r.sisaTunggakan, 0))}</td>
                <td className="px-4 py-3"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {activeTab === 'iuran' && (
        <div className="overflow-x-auto">
          {sectionBar()}
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Program Iuran</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Jenis Periode</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Nominal Tagihan</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Total Pembayaran</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Sisa Tagihan</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {iuranData.map((r) => (
                <tr key={r.iuranId}>
                  <td className="px-4 py-3 text-slate-700">{r.iuranNama}</td>
                  <td className="px-4 py-3 text-slate-700">{labelPeriodeIuran(r.jenisPeriode)}</td>
                  <td className="px-4 py-3 text-slate-700 text-right font-mono">{formatRupiah(r.nominalTagihan)}</td>
                  <td className="px-4 py-3 text-slate-700 text-right font-mono text-emerald-700">{formatRupiah(r.totalPembayaran)}</td>
                  <td className="px-4 py-3 text-slate-700 text-right font-mono text-rose-600">{formatRupiah(r.sisaTagihan)}</td>
                  <td className="px-4 py-3 text-slate-700">{statusBadge(r.status)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-100 font-bold text-slate-800 border-t-2 border-slate-300">
              <tr>
                <td colSpan={2} className="px-4 py-3 text-left uppercase">
                  TOTAL ({iuranData.length} Program Iuran)
                </td>
                <td className="px-4 py-3 text-right font-mono">{formatRupiah(iuranData.reduce((sum, r) => sum + r.nominalTagihan, 0))}</td>
                <td className="px-4 py-3 text-right font-mono text-emerald-700">{formatRupiah(iuranData.reduce((sum, r) => sum + r.totalPembayaran, 0))}</td>
                <td className="px-4 py-3 text-right font-mono text-rose-600">{formatRupiah(iuranData.reduce((sum, r) => sum + r.sisaTagihan, 0))}</td>
                <td className="px-4 py-3"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {activeTab === 'kilatan' && (
        <div className="overflow-x-auto">
          {sectionBar()}
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">No</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Event</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Total Tagihan</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Total Dibayar</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Sisa Tunggakan</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {kilatanData.map((r, idx) => (
                <tr key={r.event}>
                  <td className="px-4 py-3 text-slate-700 text-center">{idx + 1}</td>
                  <td className="px-4 py-3 text-slate-700">{r.event}</td>
                  <td className="px-4 py-3 text-slate-700 text-right font-mono">{formatRupiah(r.totalTagihan)}</td>
                  <td className="px-4 py-3 text-slate-700 text-right font-mono text-emerald-700">{formatRupiah(r.totalDibayar)}</td>
                  <td className="px-4 py-3 text-slate-700 text-right font-mono text-rose-600">{formatRupiah(r.sisaTunggakan)}</td>
                  <td className="px-4 py-3 text-slate-700">{statusBadge(r.status)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-100 font-bold text-slate-800 border-t-2 border-slate-300">
              <tr>
                <td colSpan={2} className="px-4 py-3 text-left uppercase">
                  TOTAL ({kilatanData.length} Event)
                </td>
                <td className="px-4 py-3 text-right font-mono">{formatRupiah(kilatanData.reduce((s, r) => s + r.totalTagihan, 0))}</td>
                <td className="px-4 py-3 text-right font-mono text-emerald-700">{formatRupiah(kilatanData.reduce((s, r) => s + r.totalDibayar, 0))}</td>
                <td className="px-4 py-3 text-right font-mono text-rose-600">{formatRupiah(kilatanData.reduce((s, r) => s + r.sisaTunggakan, 0))}</td>
                <td className="px-4 py-3"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Modal Pratinjau Dokumen Cetak */}
      {previewModalOpen && previewPdfUrl && previewParams && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-5xl h-[92vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-[#059669] border border-emerald-200 flex items-center justify-center shrink-0">
                  <Printer className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900">
                      Pratinjau Dokumen Cetak
                    </h3>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200 uppercase">
                      A4 • {previewParams.orientation === 'landscape' ? 'Lanskap' : 'Potret'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {previewParams.title} {previewParams.subtitle ? `• ${previewParams.subtitle}` : ''}
                  </p>
                </div>
              </div>
              <button
                onClick={handleClosePreviewModal}
                className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-xl transition-colors cursor-pointer"
                title="Tutup Pratinjau"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body: Embedded PDF viewer */}
            <div className="flex-1 p-3 sm:p-4 bg-slate-100 overflow-hidden flex flex-col">
              <iframe
                src={previewPdfUrl}
                title="Pratinjau Dokumen PDF"
                className="w-full h-full rounded-xl border border-slate-300 bg-white shadow-xs"
              />
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3 border-t border-slate-200 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-xs text-slate-500 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                Format resmi Kop Surat Pondok Pesantren Al Hidayah Tertek siap cetak
              </div>
              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={handleClosePreviewModal}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors cursor-pointer"
                >
                  Tutup
                </button>
                <button
                  onClick={() => {
                    if (previewParams) printLaporanPdf(previewParams);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-slate-800 hover:bg-slate-900 text-white rounded-lg transition-colors shadow-2xs cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Cetak Dokumen</span>
                </button>
                <button
                  onClick={() => {
                    if (previewParams) exportLaporanToPdf(previewParams);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white rounded-lg transition-colors shadow-2xs cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Unduh PDF</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LaporanPage;
