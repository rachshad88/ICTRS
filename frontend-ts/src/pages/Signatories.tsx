import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryClient } from '../services/queryClient';
import { api } from '../services/api';
import Skeleton from '../components/Skeleton';

interface SignatoriesForm {
  supervisor_name: string;
  supervisor_position: string;
  mayor_name: string;
}

interface SignatoriesRecord extends SignatoriesForm {
  updated_at: string | null;
  updated_by: string | null;
}

const EMPTY: SignatoriesForm = { supervisor_name: '', supervisor_position: '', mayor_name: '' };

const pick = (r: SignatoriesForm): SignatoriesForm => ({
  supervisor_name: r.supervisor_name,
  supervisor_position: r.supervisor_position,
  mayor_name: r.mayor_name,
});

function Signatories() {
  const [form, setForm] = useState<SignatoriesForm>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Shared with the DAR export in Reports (['meta', 'signatories']).
  const { data, isPending: loading, isError } = useQuery({
    queryKey: ['meta', 'signatories'],
    queryFn: () => api.get<SignatoriesRecord>('/signatories').then((r) => r.data),
  });
  const updatedAt = data?.updated_at ?? null;
  const updatedBy = data?.updated_by ?? null;

  // Fill the form once. Later refreshes must not overwrite what the admin is typing.
  const filled = useRef(false);
  useEffect(() => {
    if (data && !filled.current) {
      filled.current = true;
      setForm(pick(data));
    }
  }, [data]);
  useEffect(() => { if (isError) setError('Failed to load signatories'); }, [isError]);

  const setField = (field: keyof SignatoriesForm) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    setSuccess('');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      const res = await api.put('/signatories', {
        supervisor_name: form.supervisor_name.trim(),
        supervisor_position: form.supervisor_position.trim(),
        mayor_name: form.mayor_name.trim(),
      });
      setForm(pick(res.data));
      queryClient.setQueryData(['meta', 'signatories'], res.data);
      setSuccess('Signatories saved. New DAR exports will use these names.');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error || 'Failed to save signatories');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-wrap">
      <div className="page-header">
        <h2>Signatories</h2>
        <p className="page-subtitle">Names printed on the signature lines of the Daily Accomplishment Report</p>
      </div>

      {loading ? (
        <Skeleton variant="table" rows={3} />
      ) : (
        <div className="card edit-form-card">
          {error && <div className="message error">{error}</div>}
          {success && <div className="message success">{success}</div>}

          <form onSubmit={handleSave}>
            <h3 className="signatories-heading">IT Supervisor / Head</h3>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="sig-supervisor-name">Full Name</label>
                <input
                  autoCapitalize="characters"
                  spellCheck={false}
                  id="sig-supervisor-name"
                  type="text"
                  value={form.supervisor_name}
                  onChange={setField('supervisor_name')}
                  placeholder="e.g. JUAN A. DELA CRUZ"
                  maxLength={120}
                />
              </div>
              <div className="form-group">
                <label htmlFor="sig-supervisor-position">Position</label>
                <input
                  id="sig-supervisor-position"
                  type="text"
                  value={form.supervisor_position}
                  onChange={setField('supervisor_position')}
                  placeholder="e.g. Executive Assistant II"
                  maxLength={120}
                />
              </div>
            </div>

            <h3 className="signatories-heading">Municipal Mayor</h3>
            <div className="form-group">
              <label htmlFor="sig-mayor-name">Full Name</label>
              <input
                autoCapitalize="characters"
                spellCheck={false}
                id="sig-mayor-name"
                type="text"
                value={form.mayor_name}
                onChange={setField('mayor_name')}
                placeholder="e.g. ATTY. JUAN A. DELA CRUZ"
                maxLength={120}
              />
            </div>

            {updatedAt && (
              <p className="signatories-meta">
                Last updated {new Date(updatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                {updatedBy ? ` by ${updatedBy}` : ''}
              </p>
            )}

            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export default Signatories;
