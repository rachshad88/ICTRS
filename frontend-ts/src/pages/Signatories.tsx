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
  // The names are shown locked; Edit unlocks them, and Update or Cancel locks them again.
  const [editing, setEditing] = useState(false);
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
      setSuccess('Signatories updated. New DAR exports will use these names.');
      setEditing(false);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error || 'Failed to update signatories');
    } finally {
      setSaving(false);
    }
  };

  const startEditing = () => {
    setSuccess('');
    setError('');
    setEditing(true);
  };

  // Drops unsaved changes and goes back to the saved names.
  const cancelEditing = () => {
    if (data) setForm(pick(data));
    setError('');
    setEditing(false);
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
        <div className="card edit-form-card signatories-card">
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
                  disabled={!editing}
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
                  disabled={!editing}
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
                disabled={!editing}
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
              {editing ? (
                <>
                  <button type="button" className="btn btn-secondary" onClick={cancelEditing} disabled={saving}>
                    Cancel
                  </button>
                  {/* Keyed apart from Edit, so the browser never sees the Edit click land on a submit button. */}
                  <button key="update" type="submit" className="btn btn-primary" disabled={saving}>
                    {saving ? 'Updating...' : 'Update'}
                  </button>
                </>
              ) : (
                <button key="edit" type="button" className="btn btn-primary" onClick={startEditing}>
                  Edit
                </button>
              )}
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export default Signatories;
