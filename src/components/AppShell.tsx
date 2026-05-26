import {
  Banknote,
  BedDouble,
  Building2,
  CalendarCheck,
  CalendarDays,
  FileWarning,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  ScrollText,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { ALL_CAMPS, useCamp } from '../contexts/CampContext';

export function AppShell() {
  const { profile, role, signOut } = useAuth();
  const { camps, selectedCampId, selectedCamp, setSelectedCampId, error: campError } = useCamp();
  const location = useLocation();
  const canEdit = role === 'admin' || role === 'staff';
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const closeMobileMenu = () => setIsMobileMenuOpen(false);
  const campDisplayName = selectedCampId === ALL_CAMPS ? '全部營區' : selectedCamp?.name ?? '未選擇營區';
  const campThemeClass = selectedCamp?.name.includes('秋慕')
    ? 'camp-theme-qiumu'
    : selectedCamp?.name.includes('燈火')
      ? 'camp-theme-denghuo'
      : 'camp-theme-all';

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 });
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  return (
    <div
      className={`app-shell ${campThemeClass} ${isMobileMenuOpen ? 'mobile-menu-open' : ''} ${
        isSidebarCollapsed ? 'desktop-sidebar-collapsed' : ''
      }`}
    >
      <button
        type="button"
        className="desktop-sidebar-toggle"
        onClick={() => setIsSidebarCollapsed((value) => !value)}
        aria-label={isSidebarCollapsed ? '顯示選單' : '隱藏選單'}
      >
        {isSidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        <span>{isSidebarCollapsed ? '選單' : '收合'}</span>
      </button>
      <button
        type="button"
        className="mobile-menu-button"
        onClick={() => setIsMobileMenuOpen((value) => !value)}
        aria-label={isMobileMenuOpen ? '關閉選單' : '開啟選單'}
        aria-expanded={isMobileMenuOpen}
      >
        {isMobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
        <span>選單</span>
      </button>
      {isMobileMenuOpen && <button className="mobile-menu-backdrop" onClick={closeMobileMenu} aria-label="關閉選單" />}

      <aside className="sidebar">
        <div className="brand">
          <Building2 size={24} />
          <div>
            <strong>訂房管理</strong>
            <span>Internal PMS</span>
          </div>
        </div>

        <label className="camp-switcher">
          <span>營區</span>
          <select value={selectedCampId} onChange={(event) => setSelectedCampId(event.target.value)}>
            <option value={ALL_CAMPS}>全部營區</option>
            {camps.map((camp) => (
              <option key={camp.id} value={camp.id}>
                {camp.name}
              </option>
            ))}
          </select>
          {campError && <small>請先執行多營區 SQL</small>}
        </label>

        <nav className="nav-list">
          <NavLink to="/today" onClick={closeMobileMenu}>
            <LayoutDashboard size={18} />
            今日總覽
          </NavLink>
          <NavLink to="/availability" onClick={closeMobileMenu}>
            <CalendarCheck size={18} />
            空房日曆
          </NavLink>
          <NavLink to="/find-availability" onClick={closeMobileMenu}>
            <Search size={18} />
            找空房
          </NavLink>
          <NavLink to="/field-schedule" onClick={closeMobileMenu}>
            <ScrollText size={18} />
            現場訂房表
          </NavLink>
          <NavLink to="/bookings" onClick={closeMobileMenu}>
            <CalendarDays size={18} />
            訂房列表
          </NavLink>
          {canEdit && (
            <NavLink to="/bookings/new" onClick={closeMobileMenu}>
              <Plus size={18} />
              新增訂房
            </NavLink>
          )}
          {canEdit && (
            <NavLink to="/follow-up" onClick={closeMobileMenu}>
              <FileWarning size={18} />
              待處理追蹤
            </NavLink>
          )}
          {canEdit && (
            <NavLink to="/revenue" onClick={closeMobileMenu}>
              <Banknote size={18} />
              營收報表
            </NavLink>
          )}
          {canEdit && (
            <NavLink to="/rooms" onClick={closeMobileMenu}>
              <BedDouble size={18} />
              房間管理
            </NavLink>
          )}
          {canEdit && (
            <NavLink to="/price-calendar" onClick={closeMobileMenu}>
              <CalendarCheck size={18} />
              價格日曆
            </NavLink>
          )}
        </nav>

        <div className="user-panel">
          <div>
            <strong>{profile?.full_name || '內部使用者'}</strong>
            <span>{role ? role.toUpperCase() : '未設定角色'}</span>
          </div>
          <button className="icon-button" onClick={signOut} title="登出">
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      <main className="main-content">
        <div className="camp-context-banner" aria-label="目前營區">
          <span>目前營區</span>
          <strong>{campDisplayName}</strong>
        </div>
        <Outlet />
      </main>
    </div>
  );
}
