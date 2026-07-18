import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import WorkflowsListPage from './pages/WorkflowsListPage';
import CanvasPage from './pages/CanvasPage';
import ExecutionHistoryPage from './pages/ExecutionHistoryPage';
import CredentialsPage from './pages/CredentialsPage';
import WorkspacesPage from './pages/WorkspacesPage';
import TemplateGalleryPage from './pages/TemplateGalleryPage';
import MarketplacePage from './pages/MarketplacePage';
import ApiTokensPage from './pages/ApiTokensPage';
import AuditLogPage from './pages/AuditLogPage';
import RbacPage from './pages/RbacPage';
import FailedJobsPage from './pages/FailedJobsPage';
import SsoSettingsPage from './pages/SsoSettingsPage';
import VariablesPage from './pages/VariablesPage';
import DataTablesPage from './pages/DataTablesPage';
import WorkflowTestsPage from './pages/WorkflowTestsPage';
import BillingPage from './pages/BillingPage';
import ProtectedRoute from './components/ProtectedRoute';

const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route
            path="/workflows"
            element={
              <ProtectedRoute>
                <WorkflowsListPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/workflows/:id"
            element={
              <ProtectedRoute>
                <CanvasPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/workflows/:id/executions"
            element={
              <ProtectedRoute>
                <ExecutionHistoryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/workflows/:id/tests"
            element={
              <ProtectedRoute>
                <WorkflowTestsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/credentials"
            element={
              <ProtectedRoute>
                <CredentialsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/workspaces"
            element={
              <ProtectedRoute>
                <WorkspacesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/templates"
            element={
              <ProtectedRoute>
                <TemplateGalleryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/marketplace"
            element={
              <ProtectedRoute>
                <MarketplacePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/variables"
            element={
              <ProtectedRoute>
                <VariablesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/billing"
            element={
              <ProtectedRoute>
                <BillingPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/data-tables"
            element={
              <ProtectedRoute>
                <DataTablesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/api-tokens"
            element={
              <ProtectedRoute>
                <ApiTokensPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/audit-log"
            element={
              <ProtectedRoute>
                <AuditLogPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/roles"
            element={
              <ProtectedRoute>
                <RbacPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/sso"
            element={
              <ProtectedRoute>
                <SsoSettingsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/queue"
            element={
              <ProtectedRoute>
                <FailedJobsPage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/workflows" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
