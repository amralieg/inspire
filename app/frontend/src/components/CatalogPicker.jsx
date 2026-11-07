import { CATALOG_SEARCH_FROM, catalogListNote, catalogNames } from '../lib/catalogList';

export default function CatalogPicker({ id, value, onChange, catalogs, truncated = false, loading = false, className = '', placeholder = 'Pick a catalog' }) {
  const names = catalogNames(catalogs);
  const note = catalogListNote(catalogs, truncated, value);
  if (!truncated && names.length < CATALOG_SEARCH_FROM) {
    const options = [...new Set([value, ...names].filter(Boolean))].sort((a, b) => a.localeCompare(b));
    return (
      <select className={className} value={value || ''} onChange={(e) => onChange(e.target.value)}>
        {!value && <option value="">{placeholder}</option>}
        {options.map((name) => <option key={name} value={name}>{name}</option>)}
        {loading && <option disabled value="__loading__">Loading catalogs…</option>}
      </select>
    );
  }
  const listId = `${id}-catalogs`;
  return (
    <>
      <input dir="auto"
        type="text"
        list={listId}
        value={value || ''}
        onChange={(e) => onChange(e.target.value.trim())}
        placeholder={`Type to search ${names.length.toLocaleString('en-US')} catalogs`}
        autoComplete="off"
        spellCheck={false}
        className={className}
      />
      <datalist id={listId}>
        {names.map((name) => <option key={name} value={name} />)}
      </datalist>
      {note && <span data-catalog-note="" className="block mt-1 text-[11px] text-text-tertiary">{note}</span>}
    </>
  );
}
