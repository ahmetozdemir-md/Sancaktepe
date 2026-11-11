import { MAX_CONTRIBUTION_IMAGES } from './contributionContent'
import { validateAsset } from './repository'

const MAX_IMAGE_BYTES=4*1024*1024
async function pngFile(canvas:HTMLCanvasElement,name:string):Promise<File> {
  let current=canvas
  for(let attempt=0;attempt<4;attempt++){
    const blob=await new Promise<Blob|null>(resolve=>current.toBlob(resolve,'image/png'))
    if(blob && blob.size<=MAX_IMAGE_BYTES)return new File([blob],name.replace(/\.[^.]+$/,'')+'.png',{type:'image/png'})
    if(Math.max(current.width,current.height)<900)break
    const smaller=document.createElement('canvas');smaller.width=Math.round(current.width*.8);smaller.height=Math.round(current.height*.8)
    const ctx=smaller.getContext('2d');if(!ctx)break;ctx.drawImage(current,0,0,smaller.width,smaller.height);current=smaller
  }
  throw new Error('Görsel çok büyük. Daha küçük bir görsel seç.')
}
const scaleFor=(width:number,height:number)=>Math.min(1,1800/Math.max(width,height),Math.sqrt(3000000/(width*height)))
export async function prepareContributionFiles(files:File[]):Promise<File[]> {
  const result:File[]=[]
  for(const file of files){
    await validateAsset(file)
    if(file.type==='application/pdf'){
      const pdfjs=await import('pdfjs-dist')
      pdfjs.GlobalWorkerOptions.workerSrc=new URL('pdfjs-dist/build/pdf.worker.min.mjs',import.meta.url).href
      const task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),stopAtErrors:true,disableFontFace:true,useSystemFonts:true})
      try{
        const pdf=await task.promise
        if(pdf.numPages+result.length>MAX_CONTRIBUTION_IMAGES)throw new Error('Bir gönderide toplam en fazla 8 görsel / PDF sayfası olabilir.')
        for(let pageNumber=1;pageNumber<=pdf.numPages;pageNumber++){
          const page=await pdf.getPage(pageNumber),original=page.getViewport({scale:2})
          const viewport=page.getViewport({scale:2*scaleFor(original.width,original.height)})
          const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height)
          const context=canvas.getContext('2d');if(!context)throw new Error('PDF görseli hazırlanamadı.')
          await page.render({canvas,canvasContext:context,viewport}).promise
          result.push(await pngFile(canvas,`${file.name.replace(/\.pdf$/i,'')} - Sayfa ${pageNumber}.png`));page.cleanup()
        }
      } finally { await task.destroy() }
    } else {
      const bitmap=await createImageBitmap(file)
      try{
        const scale=scaleFor(bitmap.width,bitmap.height),canvas=document.createElement('canvas')
        canvas.width=Math.max(1,Math.floor(bitmap.width*scale));canvas.height=Math.max(1,Math.floor(bitmap.height*scale))
        const context=canvas.getContext('2d');if(!context)throw new Error('Görsel hazırlanamadı.')
        context.drawImage(bitmap,0,0,canvas.width,canvas.height);result.push(await pngFile(canvas,file.name))
      } finally { bitmap.close() }
    }
    if(result.length>MAX_CONTRIBUTION_IMAGES)throw new Error('Bir gönderide en fazla 8 görsel / PDF sayfası olabilir.')
  }
  return result
}
