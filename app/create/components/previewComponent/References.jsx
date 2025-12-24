
import Image from "next/image"

export default function References ({files, onRemove }) { 

    if (!files || files.length === 0) return <div className="text-medium"></div>  

    return (  
    <div className="flex flex-col">
       {files.map((item) => (
        <div key={item.id} className="w-full flex flex-row px-2 py-1 justify-between items-center border-b border-border-main">
        <button onClick={() => onRemove(item.id)} className="text-medium hover:cursor-pointer">
            <Image 
            src={'/Trash_Empty.svg'}
            alt="empty trash can"
            width={21}
            height={21}
            />
        </button>
        <div className="flex flex-row gap-4 items-center">
            <span className="text-medium text-text-secondary">Ref</span>
            <img 
            src={item.previewUrl} 
            alt="reference" 
            loading="lazy"
            className="w-10 h-10 object-cover rounded-xs" />
            </div>
        </div>
       ))} 
    </div>
    )
}