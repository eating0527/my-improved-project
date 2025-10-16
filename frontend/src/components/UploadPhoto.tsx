import React from "react";

export default function UploadPhoto({ uploadUrl }: { uploadUrl: string }) {
  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("image", file);
    await fetch(uploadUrl, { method: "POST", body: formData });
    alert("照片已上傳！");
  };

  return (
    <input
      type="file"
      accept="image/*"
      capture="environment"
      onChange={handleChange}
    />
  );
}