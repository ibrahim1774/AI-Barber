import React, { useState } from 'react';
import type { ServiceItem } from '../types';

// Editor-only "Add a service" control for the three web editors. The
// barber types the service themselves (title, optional price, optional
// description); nothing is pre-filled, so no placeholder text can ever be
// published. Never part of the deployed page.
interface Props {
  onAdd: (service: ServiceItem) => void;
  // Accent colour for the button border / text (each template's brand).
  accent?: string;
}


export const AddServiceRow: React.FC<Props> = ({ onAdd, accent = '#f4a100' }) => {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');

  const reset = () => { setTitle(''); setPrice(''); setDescription(''); };

  const submit = () => {
    const t = title.trim();
    if (!t) return;
    const raw = price.trim();
    // A bare number is a dollar price ("25" → "$25").
    const p = /^\d+(\.\d{1,2})?$/.test(raw) ? `$${raw}` : raw;
    onAdd({
      title: t,
      subtitle: '',
      description: description.trim(),
      icon: 'scissors',
      imageUrl: '',
      ...(p ? { price: p } : {}),
    });
    reset();
    setOpen(false);
  };

  const field: React.CSSProperties = {
    width: '100%', background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.25)',
    padding: '8px 10px', fontSize: 13, outline: 'none', borderRadius: 2,
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{ border: `1px dashed ${accent}`, color: accent, background: 'transparent', padding: '10px 16px', fontSize: 11, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', cursor: 'pointer', width: '100%' }}
      >
        + Add a service
      </button>
    );
  }

  return (
    <div style={{ border: `1px dashed ${accent}`, padding: 14, display: 'grid', gap: 8 }}>
      <input autoFocus aria-label="Service name" placeholder="Service name (e.g. Skin fade)" value={title} onChange={(e) => setTitle(e.target.value)} style={field} />
      <input aria-label="Price (optional)" placeholder="Price (optional)" value={price} onChange={(e) => setPrice(e.target.value)} style={field} />
      <input aria-label="Description (optional)" placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} style={field} />
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={submit}
          disabled={!title.trim()}
          style={{ background: accent, color: '#111', border: 'none', padding: '9px 16px', fontSize: 11, fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', cursor: 'pointer', opacity: title.trim() ? 1 : 0.5 }}
        >
          Add service
        </button>
        <button
          type="button"
          onClick={() => { reset(); setOpen(false); }}
          style={{ background: 'transparent', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.25)', padding: '9px 16px', fontSize: 11, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', cursor: 'pointer' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
};
