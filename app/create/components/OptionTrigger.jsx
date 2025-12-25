// OptionTrigger.jsx
import Image from "next/image";

export default function OptionTrigger({
  id,
  label,
  currentValue,
  openId,
  setOpenId,
  children,
  scheduleClose,   
  cancelClose, 
}) {
  const open = openId === id;

  // open by cancelling any pending close then setting openId
  const openPanel = () => {
    if (typeof cancelClose === "function") cancelClose();
    setOpenId(id);
  };

  // leave schedules the shared close
  const leavePanel = (delay = 120) => {
    if (typeof scheduleClose === "function") scheduleClose(delay);
    else setOpenId(null);
  };

  return (
    <div
      className="relative flex flex-row justify-between z-50 items-center w-full hover:bg-secondary pl-2 py-1"
      onPointerEnter={() => openPanel()}
      onPointerLeave={() => leavePanel(120)}
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpenId(open ? null : id)}
        className="flex items-center gap-3"
      >
        <span>{label}</span>
      </button>

      <div className="flex flex-row items-center gap-2">
        <span className="rounded-xs px-2 py-1 text-sm">{currentValue}</span>
        <Image src={"/Caret_Right_SM.svg"} alt="right caret" width={24} height={24} />
      </div>

      {/* children is expected to render the panel; pass a close function that uses shared scheduleClose */}
      {children && children({ open, close: () => leavePanel(0), cancelClose, scheduleClose })}
    </div>
  );
}
