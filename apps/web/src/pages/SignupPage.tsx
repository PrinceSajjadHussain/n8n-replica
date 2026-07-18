import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuthStore } from '../store/authStore';

export default function SignupPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { data } = await api.post('/auth/signup', { email, password });
      setSession(data.user, data.accessToken, data.refreshToken);
      navigate('/workflows');
    } catch (err: any) {
      const fieldErrors = err.response?.data?.error?.fieldErrors;
      const firstFieldError = fieldErrors ? Object.values(fieldErrors)[0] : undefined;
      setError(
        (Array.isArray(firstFieldError) ? firstFieldError[0] : undefined) ??
          err.response?.data?.error ??
          'Something went wrong creating your account.'
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2 text-signal font-display text-sm tracking-widest uppercase">
            <span className="w-2 h-2 rounded-full bg-signal inline-block" />
            FlowForge
          </div>
          <h1 className="mt-3 text-2xl font-semibold">Create your account</h1>
          <p className="text-muted text-sm mt-1">Start automating in a few minutes.</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-panel border border-panelBorder rounded-xl p-6 space-y-4"
        >
          {error && (
            <div className="text-alert text-sm bg-alert/10 border border-alert/30 rounded-md px-3 py-2">
              {error}
            </div>
          )}
          <div>
            <label className="block text-xs text-muted mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="focus-ring w-full bg-canvas border border-panelBorder rounded-md px-3 py-2 text-sm"
              placeholder="you@company.com"
            />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Password</label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="focus-ring w-full bg-canvas border border-panelBorder rounded-md px-3 py-2 text-sm"
              placeholder="At least 8 characters"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="focus-ring w-full bg-signal text-canvas font-medium rounded-md py-2 text-sm hover:brightness-110 disabled:opacity-50 transition"
          >
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="text-center text-muted text-sm mt-4">
          Already have an account?{' '}
          <Link to="/login" className="text-signal hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
