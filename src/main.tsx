import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AuthProvider } from './contexts/AuthContext';
import { CampProvider } from './contexts/CampContext';
import { BookingListPage } from './pages/BookingListPage';
import { AvailabilityPage } from './pages/AvailabilityPage';
import { DashboardPage } from './pages/DashboardPage';
import { FieldSchedulePage } from './pages/FieldSchedulePage';
import { FindAvailabilityPage } from './pages/FindAvailabilityPage';
import { FollowUpPage } from './pages/FollowUpPage';
import { LoginPage } from './pages/LoginPage';
import { NewBookingPage } from './pages/NewBookingPage';
import { PriceCalendarPage } from './pages/PriceCalendarPage';
import { RevenuePage } from './pages/RevenuePage';
import { RoomsPage } from './pages/RoomsPage';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <CampProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <AppShell />
                </ProtectedRoute>
              }
            >
              <Route index element={<Navigate to="/today" replace />} />
              <Route path="today" element={<DashboardPage />} />
              <Route path="availability" element={<AvailabilityPage />} />
              <Route
                path="find-availability"
                element={
                  <ProtectedRoute allowedRoles={['admin', 'staff']}>
                    <FindAvailabilityPage />
                  </ProtectedRoute>
                }
              />
              <Route path="field-schedule" element={<FieldSchedulePage />} />
              <Route
                path="bookings"
                element={
                  <ProtectedRoute allowedRoles={['admin', 'staff']}>
                    <BookingListPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="follow-up"
                element={
                  <ProtectedRoute allowedRoles={['admin', 'staff']}>
                    <FollowUpPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="revenue"
                element={
                  <ProtectedRoute allowedRoles={['admin', 'staff']}>
                    <RevenuePage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="rooms"
                element={
                  <ProtectedRoute allowedRoles={['admin', 'staff']}>
                    <RoomsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="price-calendar"
                element={
                  <ProtectedRoute allowedRoles={['admin', 'staff']}>
                    <PriceCalendarPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="bookings/new"
                element={
                  <ProtectedRoute allowedRoles={['admin', 'staff']}>
                    <NewBookingPage />
                  </ProtectedRoute>
                }
              />
            </Route>
          </Routes>
        </CampProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
