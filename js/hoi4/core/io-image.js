// ════════════════════════════════════════════════════════
//  io-image.js — 이미지 디코딩 / 변환 (DDS·TGA·PNG 등)
//  의존: 없음 (순수 함수, DOM Canvas만 사용)
// ════════════════════════════════════════════════════════

// ── 포맷 감지 (매직 바이트) ──────────────────────────────
function _detectImageFormat(buf) {
    const b = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
    if (b[0]===0x44&&b[1]===0x44&&b[2]===0x53&&b[3]===0x20) return 'dds';
    if (b[0]===0x89&&b[1]===0x50&&b[2]===0x4E&&b[3]===0x47) return 'png';
    if (b[0]===0xFF&&b[1]===0xD8) return 'jpeg';
    return 'unknown';
}

// ── PNG/JPG/BMP/TGA base64 → dataURL ────────────────────
function _imageBase64ToDataUrl(base64, ext) {
    if (!base64) return null;
    if (base64.startsWith('data:')) return base64;
    const e = (ext || '').toLowerCase().replace('.', '');
    if (e === 'tga') return _tgaBase64ToDataUrl(base64);
    const mime = e === 'jpg' || e === 'jpeg' ? 'image/jpeg'
               : e === 'bmp'                 ? 'image/bmp'
               : e === 'webp'                ? 'image/webp'
               :                              'image/png';
    return `data:${mime};base64,${base64}`;
}

// ── DDS base64 → PNG dataURL ─────────────────────────────
function _ddsBase64ToDataUrl(base64) {
    if (!base64) return null;
    if (base64.startsWith('data:')) return base64;
    try {
        const b64clean = base64.replace(/^data:[^;]+;base64,/, '');
        const bstr     = atob(b64clean);
        const bytes    = new Uint8Array(bstr.length);
        for (let i = 0; i < bstr.length; i++) bytes[i] = bstr.charCodeAt(i);
        const view = new DataView(bytes.buffer);

        if (view.getUint32(0, true) !== 0x20534444) { console.warn('DDS: bad magic'); return null; }

        const height  = view.getUint32(12, true);
        const width   = view.getUint32(16, true);
        const pfFlags = view.getUint32(80, true);
        const fourCC  = view.getUint32(84, true);
        const isDX10  = fourCC === 0x30315844;
        const dataOffset = isDX10 ? 148 : 128;

        let rgba;
        if      (fourCC === 0x31545844) rgba = _decodeDXT1(bytes.subarray(dataOffset), width, height);
        else if (fourCC === 0x33545844) rgba = _decodeDXT3(bytes.subarray(dataOffset), width, height);
        else if (fourCC === 0x35545844 || isDX10) rgba = _decodeDXT5(bytes.subarray(dataOffset), width, height);
        else if (pfFlags & 0x40) {
            const bpp = view.getUint32(88, true);
            if      (bpp === 32) rgba = _decodeBGRA32(bytes.subarray(dataOffset), width, height);
            else if (bpp === 24) rgba = _decodeBGR24(bytes.subarray(dataOffset), width, height);
            else { console.warn('DDS: unsupported BPP', bpp); return null; }
        } else if (pfFlags & 0x04) {
            const bpp = view.getUint32(88, true);
            if      (bpp === 32) rgba = _decodeBGRA32(bytes.subarray(dataOffset), width, height);
            else if (bpp === 24) rgba = _decodeBGR24(bytes.subarray(dataOffset), width, height);
            else { console.warn('DDS: unsupported BPP', bpp); return null; }
        } else { console.warn('DDS: unsupported format, fourCC=0x' + fourCC.toString(16)); return null; }

        if (!rgba) return null;
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        const imgData = ctx.createImageData(width, height);
        imgData.data.set(rgba);
        ctx.putImageData(imgData, 0, 0);
        return canvas.toDataURL('image/png');
    } catch(e) { console.warn('DDS decode error:', e); return null; }
}

function _decodeDXT1(data, w, h) {
    const out = new Uint8Array(w * h * 4); let src = 0;
    for (let by = 0; by < Math.ceil(h/4); by++) for (let bx = 0; bx < Math.ceil(w/4); bx++) {
        const c0=data[src]|(data[src+1]<<8); src+=2;
        const c1=data[src]|(data[src+1]<<8); src+=2;
        const codes=data[src]|(data[src+1]<<8)|(data[src+2]<<16)|(data[src+3]<<24); src+=4;
        const cols=_dxtColors(c0,c1,false);
        for (let py=0;py<4;py++) for (let px=0;px<4;px++) {
            const x=bx*4+px,y=by*4+py; if(x>=w||y>=h) continue;
            const ci=(codes>>((py*4+px)*2))&3, o=(y*w+x)*4;
            out[o]=cols[ci*4];out[o+1]=cols[ci*4+1];out[o+2]=cols[ci*4+2];out[o+3]=cols[ci*4+3];
        }
    }
    return out;
}
function _decodeDXT3(data, w, h) {
    const out = new Uint8Array(w * h * 4); let src = 0;
    for (let by=0;by<Math.ceil(h/4);by++) for (let bx=0;bx<Math.ceil(w/4);bx++) {
        const ab=data.subarray(src,src+8); src+=8;
        const c0=data[src]|(data[src+1]<<8); src+=2;
        const c1=data[src]|(data[src+1]<<8); src+=2;
        const codes=data[src]|(data[src+1]<<8)|(data[src+2]<<16)|(data[src+3]<<24); src+=4;
        const cols=_dxtColors(c0,c1,true);
        for (let py=0;py<4;py++) for (let px=0;px<4;px++) {
            const x=bx*4+px,y=by*4+py; if(x>=w||y>=h) continue;
            const pi=py*4+px, ci=(codes>>(pi*2))&3;
            const a4=(pi%2===0)?(ab[Math.floor(pi/2)]&0xF):(ab[Math.floor(pi/2)]>>4);
            const o=(y*w+x)*4;
            out[o]=cols[ci*4];out[o+1]=cols[ci*4+1];out[o+2]=cols[ci*4+2];out[o+3]=a4*17;
        }
    }
    return out;
}
function _decodeDXT5(data, w, h) {
    const out = new Uint8Array(w * h * 4); let src = 0;
    for (let by=0;by<Math.ceil(h/4);by++) for (let bx=0;bx<Math.ceil(w/4);bx++) {
        const a0=data[src++],a1=data[src++];
        const abits=[data[src++],data[src++],data[src++],data[src++],data[src++],data[src++]];
        const alphas=_dxtAlphas(a0,a1);
        const c0=data[src]|(data[src+1]<<8); src+=2;
        const c1=data[src]|(data[src+1]<<8); src+=2;
        const codes=data[src]|(data[src+1]<<8)|(data[src+2]<<16)|(data[src+3]<<24); src+=4;
        const cols=_dxtColors(c0,c1,true);
        for (let py=0;py<4;py++) for (let px=0;px<4;px++) {
            const x=bx*4+px,y=by*4+py; if(x>=w||y>=h) continue;
            const pi=py*4+px, ci=(codes>>(pi*2))&3, ai=_dxtAlphaIdx(abits,pi);
            const o=(y*w+x)*4;
            out[o]=cols[ci*4];out[o+1]=cols[ci*4+1];out[o+2]=cols[ci*4+2];out[o+3]=alphas[ai];
        }
    }
    return out;
}
function _dxtColors(c0,c1,forceAlpha) {
    const r0=((c0>>11)&31)*255/31|0,g0=((c0>>5)&63)*255/63|0,b0=(c0&31)*255/31|0;
    const r1=((c1>>11)&31)*255/31|0,g1=((c1>>5)&63)*255/63|0,b1=(c1&31)*255/31|0;
    const c=new Uint8Array(16);
    c[0]=r0;c[1]=g0;c[2]=b0;c[3]=255; c[4]=r1;c[5]=g1;c[6]=b1;c[7]=255;
    if (!forceAlpha&&c0<=c1) {
        c[8]=(r0+r1+1)>>1;c[9]=(g0+g1+1)>>1;c[10]=(b0+b1+1)>>1;c[11]=255;
        c[12]=0;c[13]=0;c[14]=0;c[15]=0;
    } else {
        c[8]=(2*r0+r1)/3|0;c[9]=(2*g0+g1)/3|0;c[10]=(2*b0+b1)/3|0;c[11]=255;
        c[12]=(r0+2*r1)/3|0;c[13]=(g0+2*g1)/3|0;c[14]=(b0+2*b1)/3|0;c[15]=255;
    }
    return c;
}
function _dxtAlphas(a0,a1) {
    const a=new Uint8Array(8); a[0]=a0;a[1]=a1;
    if (a0>a1) { for(let i=1;i<=6;i++) a[i+1]=((7-i)*a0+i*a1)/7|0; }
    else { for(let i=1;i<=4;i++) a[i+1]=((5-i)*a0+i*a1)/5|0; a[6]=0;a[7]=255; }
    return a;
}
function _dxtAlphaIdx(abits,pi) {
    const bitOff=pi*3,byteOff=bitOff>>3,bitShift=bitOff&7;
    return ((abits[byteOff]|(abits[byteOff+1]<<8)|(abits[byteOff+2]<<16))>>bitShift)&7;
}
function _decodeBGRA32(data,w,h) {
    const out=new Uint8Array(w*h*4);
    for(let i=0;i<w*h;i++){const s=i*4;out[s]=data[s+2];out[s+1]=data[s+1];out[s+2]=data[s];out[s+3]=data[s+3];}
    return out;
}
function _decodeBGR24(data,w,h) {
    const out=new Uint8Array(w*h*4);
    for(let i=0;i<w*h;i++){const s=i*3,o=i*4;out[o]=data[s+2];out[o+1]=data[s+1];out[o+2]=data[s];out[o+3]=255;}
    return out;
}

// ── TGA base64 → PNG dataURL ─────────────────────────────
function _tgaBase64ToDataUrl(base64) {
    try {
        const b64c  = base64.replace(/^data:[^;]+;base64,/,'');
        const bytes = Uint8Array.from(atob(b64c), c => c.charCodeAt(0));
        const idLen=bytes[0],cmType=bytes[1],imgType=bytes[2];
        const cmFirst=bytes[3]|(bytes[4]<<8),cmLen=bytes[5]|(bytes[6]<<8),cmBits=bytes[7];
        const w=bytes[12]|(bytes[13]<<8),h=bytes[14]|(bytes[15]<<8);
        const bpp=bytes[16],imgDesc=bytes[17];
        if (!w||!h) return null;
        const originTop=(imgDesc&0x20)!==0;
        const isIdx=(imgType===1||imgType===9),isRgb=(imgType===2||imgType===10),isRle=(imgType===9||imgType===10);
        if (!isIdx&&!isRgb) return null;
        let src=18+idLen, colormap=null;
        if (isIdx&&cmType===1) {
            const bpe=Math.ceil(cmBits/8); colormap=new Uint8Array(cmLen*4);
            for(let i=0;i<cmLen;i++){const o=src+i*bpe;
                if(cmBits===32){colormap[i*4]=bytes[o+2];colormap[i*4+1]=bytes[o+1];colormap[i*4+2]=bytes[o];colormap[i*4+3]=bytes[o+3];}
                else if(cmBits===24){colormap[i*4]=bytes[o+2];colormap[i*4+1]=bytes[o+1];colormap[i*4+2]=bytes[o];colormap[i*4+3]=255;}
                else{const v=bytes[o]|(bytes[o+1]<<8);colormap[i*4]=((v>>10)&0x1F)<<3;colormap[i*4+1]=((v>>5)&0x1F)<<3;colormap[i*4+2]=(v&0x1F)<<3;colormap[i*4+3]=255;}
            }
            src+=cmLen*bpe;
        } else if(!isIdx){if(cmType===1)src+=cmLen*Math.ceil(cmBits/8);if(bpp!==24&&bpp!==32)return null;}
        const bpp2=isIdx?1:bpp>>3, pixels=new Uint8Array(w*h*4);
        function readPixel(dst){
            if(isIdx){const idx=(bytes[src++]-cmFirst)*4;pixels[dst]=colormap[idx];pixels[dst+1]=colormap[idx+1];pixels[dst+2]=colormap[idx+2];pixels[dst+3]=colormap[idx+3];}
            else{const b=bytes[src++],g=bytes[src++],r=bytes[src++],a=bpp2===4?bytes[src++]:255;pixels[dst]=r;pixels[dst+1]=g;pixels[dst+2]=b;pixels[dst+3]=a;}
        }
        if(!isRle){for(let i=0;i<w*h;i++)readPixel(i*4);}
        else{let i=0;while(i<w*h){const pkt=bytes[src++],cnt=(pkt&0x7F)+1;
            if(pkt&0x80){readPixel(i*4);for(let k=1;k<cnt;k++){pixels[(i+k)*4]=pixels[i*4];pixels[(i+k)*4+1]=pixels[i*4+1];pixels[(i+k)*4+2]=pixels[i*4+2];pixels[(i+k)*4+3]=pixels[i*4+3];}}
            else{for(let k=0;k<cnt;k++)readPixel((i+k)*4);}i+=cnt;}}
        if(!originTop){const row=new Uint8Array(w*4);
            for(let y=0;y<(h>>1);y++){const t=y*w*4,bt=(h-1-y)*w*4;row.set(pixels.subarray(t,t+w*4));pixels.copyWithin(t,bt,bt+w*4);pixels.set(row,bt);}}
        const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
        const ctx=canvas.getContext('2d'),id=ctx.createImageData(w,h);
        id.data.set(pixels);ctx.putImageData(id,0,0);
        return canvas.toDataURL('image/png');
    } catch(e){console.warn('TGA decode error:',e);return null;}
}

// ── 이미지 PNG 압축 저장용 변환 ─────────────────────────
async function compressImageToPng(base64, ext) {
    const e=(ext||'').toLowerCase().replace('.','');
    if (e==='png'||e==='jpg'||e==='jpeg'||e==='webp') return {base64,ext:e};
    try {
        const dataUrl=_imageBase64ToDataUrl(base64,ext);
        if (!dataUrl) return {base64,ext:e};
        const pngDataUrl=await _dataUrlToPngDataUrl(dataUrl);
        if (!pngDataUrl) return {base64,ext:e};
        const pngB64=pngDataUrl.replace(/^data:image\/png;base64,/,'');
        if (pngB64.length>=base64.length) return {base64,ext:e};
        return {base64:pngB64,ext:'png'};
    } catch(err){console.warn('PNG 변환 실패:',err);return {base64,ext:e};}
}
function _dataUrlToPngDataUrl(dataUrl) {
    return new Promise(resolve => {
        const img=new Image();
        img.onload=()=>{try{const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext('2d').drawImage(img,0,0);resolve(c.toDataURL('image/png'));}catch(e){resolve(null);}};
        img.onerror=()=>resolve(null);
        img.src=dataUrl;
    });
}
