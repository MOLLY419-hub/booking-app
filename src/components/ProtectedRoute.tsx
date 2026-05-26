import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import type { UserRole } from '../types/database';

type Props = {
  children: JSX.Element;
  allowedRoles?: UserRole[];
};

export function ProtectedRoute({ children, allowedRoles }: Props) {
  const { session, role, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="screen-message">載入中...</div>;
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (allowedRoles && (!role || !allowedRoles.includes(role))) {
    return <Navigate to="/today" replace />;
  }

  return children;
}
