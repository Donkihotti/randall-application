import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import OptionTrigger from "./OptionTrigger"
import PanelContent from "./PanelContent"

export default function OptionsButton({ panelDefinitions, panelValues, setPanelValue }) {
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [openId, setOpenId] = useState(null); // <<-- add this
  const wrapperRef = useRef(null);

  const toggleOptions = () => setOptionsOpen(prev => !prev);
  const close = () => setOptionsOpen(false);

  // close when clicking outside (your existing effect)
  useEffect(() => {
    if (!optionsOpen) return;
    const onDocClick = (e) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target)) close();
    };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [optionsOpen]);

  // shared close timer (already in your code)
  const closeTimerRef = useRef(null);
  const cancelClose = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };
  const scheduleClose = (delay = 150) => {
    cancelClose();
    closeTimerRef.current = setTimeout(() => {
      setOpenId(null);
      closeTimerRef.current = null;
    }, delay);
  };
  const openPanel = (id) => {
    cancelClose();
    setOpenId(id);
  };
  useEffect(() => () => cancelClose(), []);

  return (
    <div className="relative inline-block" ref={wrapperRef} style={{ position: 'absolute', top: 8, right: 8 }}>
      <button
        type="button"
        onClick={toggleOptions}
        aria-expanded={optionsOpen}
        aria-controls="options-panel"
        className="button-tool rounded-xs inline-flex items-center gap-2 px-3 py-1"
      >
        <Image src="/Slider_01.svg" alt="options icon" width={18} height={18} />
        <span>Options</span>
      </button>

      {optionsOpen && (
        <div
          id="options-panel"
          role="dialog"
          aria-label="Options panel"
          className="absolute bottom-full mb-2 left-0 transform z-50 w-72 p-1 rounded-xs shadow-lg bg-main border-border-main border"
        >
          <div className="flex flex-col text-medium">
            {Object.entries(panelDefinitions).map(([id, def]) => {
              const key = def.valueKey || Object.keys(def.defaults || {})[0];
              const current = panelValues[id]?.[key];
              return (
                <OptionTrigger
                  key={id}
                  id={id}
                  label={def.label}
                  currentValue={current}
                  openId={openId}
                  setOpenId={setOpenId}
                  scheduleClose={scheduleClose}
                  cancelClose={cancelClose}
                >
                  {({ open, close, cancelClose: childCancel, scheduleClose: childSchedule }) => (
                    open && (
                      <PanelContent
                        panelId={id}
                        def={def}
                        values={panelValues}
                        setValue={setPanelValue}
                        onClose={close}
                        cancelClose={childCancel}
                        scheduleClose={childSchedule}
                      />
                    )
                  )}
                </OptionTrigger>
              )
            })}
          </div>
        </div>
      )}
    </div>
  );
}
