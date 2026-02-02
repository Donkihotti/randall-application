import Link from "next/link"
import Image from "next/image"

export default function NavBar () {
    const navItems = [
        {name: "pricing", link: "/"},
        {name: "roadmap", link: "/"},
        {name: "resources", link: "/"},
        {name: "how it works", link: "/"},
        {name: "contact", link: "/"},
    ] 

    return ( 
        <div className="w-screen flex flex-row p-2 text-black justify-between items-center">
            <div>Randall</div>
            <div className="flex flex-row gap-x-16 text-landing">
                <div className="flex flex-row gap-x-4">
                {navItems.map((item, i) => (
                    <Link key={i} href={item.link}>{item.name}</Link>
                ))}
                </div>
                <div className="flex flex-row gap-x-1 text-landing">
                    <Link className="border rounded-xs px-3" href={"/signIn"}>sign in</Link>
                    <div className="border rounded-xs p-1">
                        <Image 
                        src={"/Arrow_Up_Right_MD.svg"}
                        alt="arrow up"
                        width={18}
                        height={18}
                        />
                    </div>
                </div>
            </div>
        </div>
    )
}