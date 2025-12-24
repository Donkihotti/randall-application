import Image from "next/image";

export default function AddReferenceButton({ onFilesAdded }) {

  const handleChange = (e) => {
    const picked = Array.from(e.target.files || []); // convert FileList -> Array<File>
    if (picked.length === 0) return;
    // send the File[] to the parent
    onFilesAdded(picked);
    // reset input so selecting the same file(s) again triggers onChange
    e.target.value = '';
  }

  return (
    <label className="button-tool">
      <Image src={"/plus-icon.svg"} alt="plus icon" width={10} height={10} />
      <span>Reference</span>
      <input
        id="file"
        type="file"
        multiple
        onChange={handleChange}
        className="sr-only"
        accept="image/*"
      />
    </label>
  );
}
