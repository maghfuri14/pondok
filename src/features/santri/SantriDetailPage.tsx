import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Edit,
  User,
  Phone,
  Calendar,
  CreditCard,
  History,
  Clock,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  UserCheck,
  UserX,
} from 'lucide-react';
import { Santri } from '../../types/santri';
import { santriService } from '../../lib/santriService';
import { buatPayloadToggleStatus } from '../../lib/santriStatus';
import { SantriFormModal } from './SantriFormModal';
import { StatusToggleConfirmModal } from './StatusToggleConfirmModal';
import { authStore, AuthUser } from '../../store/authStore';
import { showToast } from '../../components/ui/Toast';

type ActiveTab = 'profil' | 'syahriyah' | 'kilatan' | 'timeline';

export const SantriDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [user, setUser] = useState<AuthUser | null>(null);
  const isAdmin = user?.role === 'super_admin' || user?.role === 'admin';

  useEffect(() => {
    authStore.getUser().then(setUser);
  }, []);

  const [santri, setSantri] = useState<Santri | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ActiveTab>('profil');
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [toggleModalOpen, setToggleModalOpen] = useState(false);
  const [isTogglingStatus, setIsTogglingStatus] = useState(false);
  const tabContainerRef = useRef<HTMLDivElement>(null);

  const scrollTabs = (direction: 'left' | 'right') => {
    if (tabContainerRef.current) {
      const scrollAmount = direction === 'left' ? -150 : 150;
      tabContainerRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  const loadData = async () => {
    if (!id) return;
    setIsLoading(true);
    try {
      const data = await santriService.getSantriById(id);
      setSantri(data);
    } catch {
      setSantri(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [id]);

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  const confirmToggleStatus = async () => {
    if (!santri || isTogglingStatus) return;
    setIsTogglingStatus(true);
    try {
      const { newStatus, payload } = buatPayloadToggleStatus(santri);
      await santriService.updateSantri(santri.id, payload);
      showToast(`Status santri diubah menjadi ${newStatus}`, 'success');
      setToggleModalOpen(false);
      await loadData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Gagal mengubah status santri', 'error');
    } finally {
      setIsTogglingStatus(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-4 sm:p-8 space-y-4 max-w-4xl mx-auto">
        <div className="animate-pulse h-6 bg-slate-200 rounded w-1/4" />
        <div className="animate-pulse h-28 bg-slate-200 rounded-2xl" />
        <div className="animate-pulse h-60 bg-slate-200 rounded-2xl" />
      </div>
    );
  }

  if (!santri) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center p-6 bg-white border border-[#E2E8F0] rounded-2xl shadow-xs max-w-lg mx-auto my-8">
        <AlertCircle className="w-12 h-12 text-slate-300 mb-3" />
        <h2 className="text-xl font-bold text-[#0F172A] mb-1">Santri Tidak Ditemukan</h2>
        <p className="text-sm text-slate-500 mb-6">
          Data santri yang Anda cari tidak ada atau telah dihapus.
        </p>
        <button
          onClick={() => navigate('/santri')}
          className="px-4 py-2 bg-[#059669] text-white text-sm font-semibold rounded-lg hover:bg-[#047857] transition-colors"
        >
          Kembali ke Data Santri
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4 sm:space-y-6 pb-12">
      {/* Top Header Row with Kembali and Compact Edit */}
      <div className="flex items-center justify-between gap-4">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Kembali</span>
        </button>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-colors shadow-xs"
            >
              <Edit className="w-3.5 h-3.5 text-slate-500" />
              <span>Edit Santri</span>
            </button>
            <button
              onClick={() => setToggleModalOpen(true)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors shadow-xs ${
                santri?.status === 'Aktif'
                  ? 'border-amber-300 text-amber-700 hover:bg-amber-50'
                  : 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'
              }`}
            >
              {santri?.status === 'Aktif' ? (
                <>
                  <UserX className="w-3.5 h-3.5" />
                  <span>Nonaktifkan</span>
                </>
              ) : (
                <>
                  <UserCheck className="w-3.5 h-3.5" />
                  <span>Aktifkan Kembali</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Profile Card Header */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4 sm:p-6 shadow-xs flex items-center gap-4 sm:gap-6">
        <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-emerald-100 text-emerald-700 font-bold text-lg sm:text-xl flex items-center justify-center shrink-0 border-2 border-emerald-400">
          {santri.nama.trim().substring(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h1 className="text-lg sm:text-2xl font-bold text-[#0F172A] tracking-tight truncate">
              {santri.nama}
            </h1>
            <span className="text-xs font-mono text-slate-400">NIS: {santri.nis}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {santri.kategori === 'Mukim' && (
              <span className="px-2 py-0.5 rounded-md font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                Mukim
              </span>
            )}
            {santri.kategori === 'Nduduk' && (
              <span className="px-2 py-0.5 rounded-md font-semibold bg-purple-50 text-purple-700 border border-purple-200">
                Nduduk
              </span>
            )}
            {santri.kategori === 'Kilatan' && (
              <span className="px-2 py-0.5 rounded-md font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                Kilatan
              </span>
            )}
            
            {santri.status === 'Aktif' ? (
              <span className="px-2 py-0.5 rounded-md font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                Aktif
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-md font-semibold bg-red-50 text-red-700 border border-red-200">
                Tidak Aktif
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Inline Symmetrical Tab Header Navigation */}
      <div className="flex items-center justify-between gap-1 sm:gap-2 w-full border-b border-slate-200 group">
        <button
          type="button"
          onClick={() => scrollTabs('left')}
          aria-label="Scroll Tabs Left"
          className="p-1 sm:p-1.5 rounded-full border border-slate-200 bg-white shadow-xs text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-all opacity-40 group-hover:opacity-100 shrink-0 mb-1"
          title="Scroll Kiri"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div
          ref={tabContainerRef}
          className="flex items-center gap-4 sm:gap-6 overflow-x-auto text-sm font-medium whitespace-nowrap no-scrollbar [&::-webkit-scrollbar]:hidden [scrollbar-width:none] flex-1 px-2 scroll-smooth"
        >
          {[
            { key: 'profil', label: 'Profil Lengkap', icon: User },
            { key: 'syahriyah', label: 'Riwayat Syahriyah', icon: CreditCard },
            { key: 'kilatan', label: 'Riwayat Kilatan', icon: History },
            { key: 'timeline', label: 'Timeline', icon: Clock },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key as ActiveTab)}
                className={`pb-3 inline-flex items-center gap-2 transition-colors border-b-2 font-semibold whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'border-[#059669] text-[#059669]'
                    : 'border-transparent text-[#64748B] hover:text-[#0F172A]'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => scrollTabs('right')}
          aria-label="Scroll Tabs Right"
          className="p-1 sm:p-1.5 rounded-full border border-slate-200 bg-white shadow-xs text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-all opacity-40 group-hover:opacity-100 shrink-0 mb-1"
          title="Scroll Kanan"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Tab Content */}
      <div className="pt-1">
        {activeTab === 'profil' && (
          <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4 sm:p-6 shadow-xs space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
              <div className="space-y-4">
                <h3 className="font-bold text-[#0F172A] text-base border-b border-slate-100 pb-2 flex items-center gap-2">
                  <User className="w-4 h-4 text-[#059669]" />
                  Informasi Santri
                </h3>
                <div className="space-y-3 text-xs">
                  <div>
                    <span className="text-slate-400 block font-medium">Nama Lengkap</span>
                    <span className="text-[#0F172A] font-semibold text-sm">{santri.nama}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-medium">Nomor Induk Santri (NIS)</span>
                    <span className="text-[#0F172A] font-mono font-semibold">{santri.nis}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-medium">No. HP Santri</span>
                    <span className="text-[#0F172A] font-medium flex items-center gap-1.5 mt-0.5">
                      <Phone className="w-3.5 h-3.5 text-slate-400" />
                      {santri.no_hp_santri}
                    </span>
                  </div>
                </div>
              </div>
              <div className="space-y-4">
                <h3 className="font-bold text-[#0F172A] text-base border-b border-slate-100 pb-2 flex items-center gap-2">
                  <User className="w-4 h-4 text-[#059669]" />
                  Informasi Wali & Pendaftaran
                </h3>
                <div className="space-y-3 text-xs">
                  <div>
                    <span className="text-slate-400 block font-medium">Nama Wali</span>
                    <span className="text-[#0F172A] font-semibold text-sm">{santri.nama_wali}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-medium">No. HP Wali</span>
                    <span className="text-[#0F172A] font-medium flex items-center gap-1.5 mt-0.5">
                      <Phone className="w-3.5 h-3.5 text-slate-400" />
                      {santri.no_hp_wali}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-medium">Tanggal Terdaftar</span>
                    <span className="text-[#0F172A] font-medium flex items-center gap-1.5 mt-0.5">
                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                      {formatDate(santri.tanggal_masuk)}
                    </span>
                  </div>
                  {santri.status === 'Tidak Aktif' && santri.tanggal_keluar && (
                    <div>
                      <span className="text-slate-400 block font-medium">Tanggal Keluar</span>
                      <span className="text-[#0F172A] font-medium flex items-center gap-1.5 mt-0.5">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        {formatDate(santri.tanggal_keluar)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Riwayat Status */}
            {(santri.periode_nonaktif?.length || 0) > 0 && (
              <div>
                <h3 className="font-bold text-[#0F172A] text-base border-b border-slate-100 pb-2 flex items-center gap-2">
                  <History className="w-4 h-4 text-[#059669]" />
                  Riwayat Status
                </h3>
                <div className="mt-2 space-y-1.5">
                  {(santri.periode_nonaktif || []).map((p, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2"
                    >
                      <UserX className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      <span className="text-slate-700 font-medium">
                        Tidak aktif: {formatDate(p.mulai)} →{' '}
                        {p.sampai ? formatDate(p.sampai) : 'masih tidak aktif'}
                      </span>
                    </div>
                  ))}
                  <p className="text-[11px] text-slate-500">
                    Bulan di sela periode tidak aktif tidak ditagih; bulan penonaktifan dan
                    pengaktifan kembali tetap ditagih.
                  </p>
                </div>
              </div>
            )}

            {santri.catatan && (
              <div className="border-t border-slate-100 pt-4">
                <span className="text-xs text-slate-400 font-medium block mb-1">Catatan Khusus</span>
                <p className="text-xs text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-200">
                  {santri.catatan}
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'syahriyah' && (
          <div className="bg-white border border-[#E2E8F0] rounded-2xl p-8 sm:p-12 text-center shadow-xs">
            <CreditCard className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <h3 className="text-base font-semibold text-[#0F172A] mb-1">Riwayat Syahriyah</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto mb-4">
              Untuk melihat matriks lengkap dan mencatat pembayaran bulanan santri, silakan kunjungi menu Syahriyah di sidebar.
            </p>
            <button
              onClick={() => navigate('/syahriyah')}
              className="px-4 py-2 bg-[#059669] hover:bg-[#047857] text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
            >
              Buka Menu Syahriyah
            </button>
          </div>
        )}

        {activeTab === 'kilatan' && (
          <div className="bg-white border border-[#E2E8F0] rounded-2xl p-8 sm:p-12 text-center shadow-xs">
            <History className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <h3 className="text-base font-semibold text-[#0F172A] mb-1">Riwayat Kilatan</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto mb-4">
              Kelola dan catat transaksi pendaftaran program kilatan santri di modul Kilatan.
            </p>
            <button
              onClick={() => navigate('/kilatan')}
              className="px-4 py-2 bg-[#059669] hover:bg-[#047857] text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
            >
              Buka Menu Kilatan
            </button>
          </div>
        )}

        {activeTab === 'timeline' && (
          <div className="bg-white border border-[#E2E8F0] rounded-2xl p-8 sm:p-12 text-center shadow-xs">
            <Clock className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <h3 className="text-base font-semibold text-[#0F172A] mb-1">Timeline Aktivitas</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Aktivitas santri dicatat secara otomatis saat transaksi atau pembaruan data dilakukan.
            </p>
          </div>
        )}
      </div>

      {/* Modal Edit */}
      {isAdmin && santri && (
        <SantriFormModal
          isOpen={editModalOpen}
          onClose={() => setEditModalOpen(false)}
          santriId={santri.id}
          onSuccess={loadData}
        />
      )}

      {/* Modal Konfirmasi Ubah Status */}
      {isAdmin && santri && (
        <StatusToggleConfirmModal
          santri={toggleModalOpen ? santri : null}
          isLoading={isTogglingStatus}
          onConfirm={confirmToggleStatus}
          onClose={() => setToggleModalOpen(false)}
        />
      )}
    </div>
  );
};

export default SantriDetailPage;
