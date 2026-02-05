import Image from "next/image"

export default function ButtonGenerateRound ({ className, }) { 
    return ( 
        <div className={`bg-main-white/80 rounded-xs flex items-center justify-center w-8 h-8 hover:cursor-pointer hover:bg-main-white ${className}`}>
            <Image 
            src={'Arrow_Up_MD.svg'}
            alt="arrow up"
            width={24}
            height={24}
            />
        </div>
    )
}