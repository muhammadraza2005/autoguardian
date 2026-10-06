const fs=require('node:fs/promises');const path=require('node:path');const sharp=require('sharp');
async function main() {
  const destination=path.resolve(__dirname,'../../.tools/upload-samples');await fs.mkdir(destination,{recursive:true});
  const samples=[['sample-owner-document.jpg','Owner document upload test'],['sample-vehicle-photo.jpg','Vehicle photo upload test'],
    ...[1,2,3,4].map(n=>['sample-seal-fitting-'+n+'.jpg','Seal fitting sample position '+n])];
  for(const [name,label] of samples) {
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#ffffff"/><rect x="20" y="20" width="600" height="360" rx="12" fill="#f5f7fa" stroke="#142b4a"/><text x="45" y="95" font-family="sans-serif" font-size="30" fill="#142b4a">AutoGuardian</text><text x="45" y="155" font-family="sans-serif" font-size="24" fill="#142b4a">${label}</text><text x="45" y="235" font-family="sans-serif" font-size="24" fill="#142b4a">SYNTHETIC SAMPLE ONLY</text><text x="45" y="295" font-family="sans-serif" font-size="20" fill="#536174">No real identity, document or vehicle data</text></svg>`;
    await sharp(Buffer.from(svg)).jpeg({quality:85}).toFile(path.join(destination,name));
  }
  console.log('Synthetic JPEG samples prepared in .tools/upload-samples.');
}
void main().catch(()=>{console.error('Could not prepare sample files.');process.exitCode=1;});
