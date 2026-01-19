import Image from "next/image"

export default function ConnectPort () { 
    return ( 
        <div className="w-1.5 h-1.5 rounded-full border">
            <Image 
            src={'/Add_Plus.svg'}
            alt="Plus icon"
            height={4}
            width={4}
            />
        </div>
    )
}