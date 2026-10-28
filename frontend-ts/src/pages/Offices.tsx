import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../services/api';
import { queryClient } from '../services/queryClient';
import SearchBox from '../components/SearchBox';
import Skeleton from '../components/Skeleton';
import RequestTicket from '../components/RequestTicket';
import IconButton from '../components/IconButton';

interface Office {
  _id: string;
  name: string;
  active: boolean;
  users: number;
}

const NO_OFFICES: Office[] = [];

const errorText = (err: unknown, fallback: string) =>
  (err as { response?: { data?: { error?: string } } }).response?.data?.error || fallback;

// The super admin's list of offices people pick at sign-up, on their profile and in User Management.
// Offices are never deleted: hiding one takes it off the pickers but leaves it on the accounts and
// requests that already use it.
function Offices() {
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const { data, isPending: loading } = useQuery({
    queryKey: ['offices', 'all'],
    queryFn: () => api.get<{ offices: Office[] }>('/offices/all').then((r) => r.data.offices),
  });
  const offices = data ?? NO_OFFICES;

  // The pickers (['meta', 'offices']) and the user list show office names too.
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['offices'] }),
    queryClient.invalidateQueries({ queryKey: ['meta', 'offices'] }),
    queryClient.invalidateQueries({ queryKey: ['users'] }),
  ]);

  const say = (ok: string) => { setError(''); setSuccess(ok); };
  const fail = (msg: string) => { setSuccess(''); setError(msg); };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name || adding) return;
    setAdding(true);
    try {
      await api.post('/offices', { name });
      setNewName('');
      say(`${name} was added. People can pick it now.`);
      await refresh();
    } catch (err) {
      fail(errorText(err, 'Failed to add office'));
    } finally {
      setAdding(false);
    }
  };

  const startRename = (office: Office) => {
    setEditingId(office._id);
    setEditName(office.name);
    setError('');
    setSuccess('');
  };

  const handleRename = async (e: React.FormEvent, office: Office) => {
    e.preventDefault();
    const name = editName.trim();
    if (!name || busyId) return;
    if (name === office.name) { setEditingId(null); return; }
    if (office.users > 0 && !window.confirm(`Rename ${office.name} to ${name}? The ${office.users} account${office.users === 1 ? '' : 's'} on it and their IT requests will show the new name.`)) return;
    setBusyId(office._id);
    try {
      await api.put(`/offices/${office._id}`, { name });
      setEditingId(null);
      say(`${office.name} is now ${name}.`);
      await refresh();
    } catch (err) {
      fail(errorText(err, 'Failed to rename office'));
    } finally {
      setBusyId(null);
    }
  };

  const handleSetActive = async (office: Office, active: boolean) => {
    if (busyId) return;
    setBusyId(office._id);
    try {
      await api.put(`/offices/${office._id}/active`, { active });
      say(active ? `${office.name} can be picked again.` : `${office.name} is hidden. Accounts already on it keep it.`);
      await refresh();
    } catch (err) {
      fail(errorText(err, 'Failed to update office'));
    } finally {
      setBusyId(null);
    }
  };

  // Rename in place, and the row's buttons; the table and the phone tickets each pass their own
  // form id, so the Save button submits the form that is on screen.
  const renameForm = (office: Office, formId: string) => (
    <form id={`${formId}-${office._id}`} className="form-group office-rename" onSubmit={(e) => handleRename(e, office)}>
      <input
        type="text"
        value={editName}
        onChange={(e) => setEditName(e.target.value)}
        maxLength={120}
        aria-label="Office name"
        autoFocus
      />
    </form>
  );

  const officeActions = (office: Office, formId: string) => (
    <div className="history-actions">
      {/* Keyed apart, so the Rename click never lands on the Save button that replaces it. */}
      {editingId === office._id ? (
        <>
          <IconButton key="save" icon="save" label={busyId === office._id ? 'Saving...' : 'Save'} about={office.name} tone="hbtn-assign" submitFor={`${formId}-${office._id}`} disabled={busyId !== null || editName.trim().length < 2} />
          <IconButton key="cancel" icon="close" label="Cancel" about={office.name} onClick={() => setEditingId(null)} />
        </>
      ) : (
        <>
          <IconButton key="rename" icon="edit" label="Rename" about={office.name} onClick={() => startRename(office)} disabled={busyId !== null} />
          {office.active
            ? <IconButton icon="hide" label="Hide" about={office.name} tone="hbtn-cancel" onClick={() => handleSetActive(office, false)} disabled={busyId !== null} />
            : <IconButton icon="view" label="Show" about={office.name} tone="hbtn-assign" onClick={() => handleSetActive(office, true)} disabled={busyId !== null} />}
        </>
      )}
    </div>
  );

  const term = searchTerm.toLowerCase();
  const shown = term ? offices.filter((o) => o.name.toLowerCase().includes(term)) : offices;
  const activeCount = offices.filter((o) => o.active).length;

  return (
    <div className="page-wrap">
      <div className="page-header">
        <h2>Offices</h2>
        <p className="page-subtitle">
          Offices people pick when signing up, on their profile and in User Management
          {data ? ` (${activeCount} shown, ${offices.length - activeCount} hidden)` : ''}
        </p>
      </div>

      {error && <div className="message error">{error}</div>}
      {success && <div className="message success">{success}</div>}

      <div className="filters-row">
        <form className="search-form" onSubmit={handleAdd} aria-label="Add an office">
          <input
            type="text"
            className="search-input"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New office name, e.g. MMO - Records Section"
            maxLength={120}
            aria-label="New office name"
          />
          <button type="submit" className="hbtn hbtn-assign search-btn" disabled={adding || newName.trim().length < 2}>
            {adding ? 'Adding...' : 'Add office'}
          </button>
        </form>
        <SearchBox value={searchTerm} onSearch={setSearchTerm} placeholder="Search offices" />
      </div>

      {loading ? (
        <Skeleton variant="table" rows={6} />
      ) : shown.length === 0 ? (
        <div className="history-empty">{term ? 'No offices match this search.' : 'No offices yet.'}</div>
      ) : (
        <>
          <div className="history-table-wrap hide-on-mobile">
            <table className="history-table stack-mobile">
              <thead>
                <tr>
                  <th>Office</th>
                  <th>Accounts</th>
                  <th className="col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((office) => (
                  <tr key={office._id} className={office.active ? undefined : 'is-inactive'}>
                    <td className="td-cell" data-label="Office">
                      {editingId === office._id ? renameForm(office, 'rename') : (
                        <>
                          <div>{office.name}</div>
                          {!office.active && <div className="um-inactive">Hidden</div>}
                        </>
                      )}
                    </td>
                    <td className="td-cell" data-label="Accounts">{office.users}</td>
                    <td className="col-actions">{officeActions(office, 'rename')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rq-ticket-list">
            {shown.map((office, idx) => (
              <RequestTicket
                key={office._id}
                index={idx}
                brand="ITRS office"
                type="Office"
                title={editingId === office._id ? renameForm(office, 'rename-m') : office.name}
                status={office.active ? 'SHOWN' : 'HIDDEN'}
                meta={[{ label: 'Accounts', value: office.users }]}
                actions={officeActions(office, 'rename-m')}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default Offices;
