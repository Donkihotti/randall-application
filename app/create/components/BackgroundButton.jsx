import { useState, useRef, useEffect } from 'react'
import Image from 'next/image';

export default function BackgroundButton () { 
    const [isPanelOpen, setIsPanelOpen] = useState(false); 
    const [uploadedFile, setUploadedFile] = useState(null); 
    const [previewUrl, setPreviewUrl] = useState(null); 
    const wrapperRef = useRef(null)

    useEffect(() => {
    if (!isPanelOpen) return
    const onDocClick = (e) => {
        if (!wrapperRef.current.contains(e.target)) {
        setIsPanelOpen(false)
        }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
    }, [isPanelOpen])
    
    const togglePanel = () => {setIsPanelOpen( prev => !prev )}

    const handleFileChange = (e) => { 
        const file = e.target.files?.[0] ?? null 
        setUploadedFile(file) 
    }

    useEffect(() => { 
        if (!uploadedFile) { 
            setPreviewUrl(null)
            return
        } 
        const url = URL.createObjectURL(uploadedFile) 
        setPreviewUrl(url) 
        return () => { 
            URL.revokeObjectURL(url)
        }
    }, [uploadedFile])

    return (
        <div className='relative'>
        <button onClick={togglePanel} className={  uploadedFile ? "button-tool bg-button-create text-black hover:border-button-create" : "button-tool"}>
            { uploadedFile 
            ?
            <Image
            src={"/plus-icon-black.svg"}
            alt='plus icon'
            height={10}
            width={10}
            />
            :
            <Image
            src={"/plus-icon.svg"}
            alt='plus icon'
            height={10}
            width={10}
            />
            }
            <span>Background</span>
        </button>
        { isPanelOpen && (
            <div className='bg-main h-28 w-56 rounded-md border-border-main border absolute bottom-full mb-1.5 transform flex flex-col gap-y-1 p-1 drop-shadow-md' ref={wrapperRef}>
               <label className="cursor-pointer w-full flex items-center gap-2 p-3 rounded-xs bg-secondary">
                { previewUrl
                ?  
                <div className='absolute top-2 left-2 h-9 w-8'>
                <Image
                src={previewUrl}
                alt='file upload icon'
                fill={true}
                className='rounded-xs object-cover'
                />
                </div>
                :
                <Image
                src={"/File_Upload.svg"}
                alt='file upload icon'
                height={20}
                width={20}
                />
                }
                <span className="text-sm">Add Background ref</span>
                <input
                    id="file"
                    type="file"
                    onChange={handleFileChange}
                    className="sr-only"   
                    accept="image/*"
                />
                </label>
            </div>
        )}
        </div>
     )
}