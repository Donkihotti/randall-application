import Image from "next/image";

export default function PanelContent({ panelId, def, values, setValue, onClose }) {
  const cfg = def || {};
  const val = values[panelId] || {};
  const key = def.valueKey || Object.keys(def.defaults || {})[0];

  return (
    <div
      className="absolute top-0 left-full ml-2 z-50 w-40 bg-main rounded-xs border border-border-main shadow p-1"
      role="menu"
      onPointerEnter={() => { typeof cancelClose === 'function' && cancelClose(); }}
      onPointerLeave={() => { typeof scheduleClose === 'function' ? scheduleClose(120) : onClose(); }}
    >
      {cfg.options?.map(opt => {
        const isActive = (val[key]) === opt;
        return (
          <button
            key={opt}
            role="menuitem"
            className={`w-full text-left px-2 py-1 flex items-center justify-between hover:bg-secondary ${isActive ? 'bg-accent' : ''}`}
            onClick={() => {
              setValue(panelId, key, opt);
              onClose(); 
            }}
          >
            <span>{opt}</span>
            {isActive && (
              <Image src="/Check.svg" alt="selected" width={16} height={16} />
            )}
          </button>
        )
      })}
    </div>
  );
}
