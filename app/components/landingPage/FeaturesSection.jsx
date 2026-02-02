import Image from "next/image"

export default function FeatureSection ({ src="", headerText="", subText="", alt="" }) { 
    return ( 
        <section className="h-screen w-screen p-3.5 flex flex-row">
            <div className="w-5/12 h-full">
            <h3 className="text-header leading-14 font-semibold mt-2">{headerText}</h3>
            <p className="mt-4 text-medium-plus">{subText}</p>
            </div>
            <div className="w-7/12 h-full relative rounded-xs">
            <Image 
            src={src}
            alt={alt}
            fill={true}
            className="rounded-xs"
            />
            </div>
        </section>
    )
}