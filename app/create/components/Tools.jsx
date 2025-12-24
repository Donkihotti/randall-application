
import AddReferenceButton from "./AddReferenceButton"
import BackgroundButton from "./BackgroundButton"

export default function Tools ({onFilesAdded}) { 
    return ( 
        <div className="w-full flex flex-row gap-x-2">
            <AddReferenceButton onFilesAdded={onFilesAdded}/>
            <BackgroundButton />
        </div>
    )
}