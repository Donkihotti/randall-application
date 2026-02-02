import Image from "next/image";
import FeaturesSection from "./components/landingPage/FeaturesSection"
import Hero from "@/app/components/landingPage/Hero"
import NavBar from "./components/NavBar"

export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center  font-sans ">
      <main>
        <NavBar />  
       <Hero />
        <FeaturesSection 
        src="/"
        headerText="Node based design system" 
        subText="Generate images easily with a node based system"/>
         <FeaturesSection 
        src="/"
        headerText="Create characters that are easily used in different projects" 
        subText={`Create characters that stay consistent tomorrow and 10 years from now. Great for brands that need consistent models for photoshoots."`}/>
         <FeaturesSection 
        src="/"
        headerText="All image models on one platform" 
        subText="No need to jump between platforms. All the models for all of your needs on one platform for ease of use."/>
      </main>
    </div>
  );
}
