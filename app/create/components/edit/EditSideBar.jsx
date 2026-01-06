import { useState } from "react";
import ButtonEditIcon from "../ButtonEditIcon"

export default function EditSideBar() {
  const [ selectedPrompt, setSelectedPrompt] = useState(''); 

  const handleChildEnter = () => {}
  const handleChildLeave = () => {}

  const handlePromptClick = (prompt) => { 
    setSelectedPrompt(prompt);
  }

  return (    
    <div className="h-full w-20 bg-canvas text-white flex flex-col p-2">
      <ButtonEditIcon
        src="/Chat_Dots.svg"
        alt="thumbnail"
        width={24}
        height={24}
        label="Edit"
        tooltip="Prompt"
        onMouseEnter={handleChildEnter}
        onMouseLeave={handleChildLeave}
        onClick={handlePromptClick}
      />
    </div>
  );
}
