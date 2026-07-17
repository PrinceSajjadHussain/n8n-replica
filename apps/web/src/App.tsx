import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import WorkflowsListPage from './pages/WorkflowsListPage';
import CanvasPage from './pages/CanvasPage';
import ExecutionHistoryPage from './pages/ExecutionHistoryPage';
import CredentialsPage from './pages/CredentialsPage';
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
            path="/credentials"
            element={
              <ProtectedRoute>
                <CredentialsPage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/workflows" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
