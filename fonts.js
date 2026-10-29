/* 문서 글꼴 대응.
   한글 문서는 휴먼명조·HY견명조·함초롬바탕 같은 상용 글꼴을 쓴다. 없는 기기에서는
   브라우저가 아무 글꼴로나 대체해 명조 문서가 고딕으로 보인다. 여기서는
   1) 원래 이름을 그대로 앞에 두고 2) 같은 계열(명조/고딕/고정폭)의 대체 글꼴을 잇고
   3) 사용자가 가진 글꼴 파일을 직접 넣을 수 있게 한다. */
(function(){
  'use strict';

  var SERIF = ['HCR Batang','함초롬바탕','한컴바탕','Batang','바탕','AppleMyungjo',
               'Nanum Myeongjo','NanumMyeongjo','Noto Serif KR','Noto Serif CJK KR',
               'Source Han Serif K','UnBatang','serif'];
  var SANS  = ['HCR Dotum','함초롬돋움','한컴돋움','Malgun Gothic','맑은 고딕',
               'Apple SD Gothic Neo','NanumGothic','Noto Sans KR','Noto Sans CJK KR',
               'Source Han Sans K','UnDotum','sans-serif'];
  var MONO  = ['D2Coding','NanumGothic Coding','Noto Sans Mono','Consolas','monospace'];

  var SERIF_RX = /명조|바탕|신명|중명|궁서|myeongjo|batang|serif|times|georgia|바탕체/i;
  var MONO_RX  = /mono|coding|code|courier|fixed|굴림체|gulimche/i;

  function classify(name){
    if(MONO_RX.test(name)) return 'mono';
    if(SERIF_RX.test(name)) return 'serif';
    return 'sans';
  }

  function stack(name){
    var list = classify(name)==='serif' ? SERIF : classify(name)==='mono' ? MONO : SANS;
    var out = ["'"+String(name).replace(/'/g, "\\'")+"'"];
    for(var i=0;i<list.length;i++){
      if(list[i].toLowerCase()===String(name).toLowerCase()) continue;
      out.push(/[가-힣]/.test(list[i]) || /\s/.test(list[i]) ? "'"+list[i]+"'" : list[i]);
    }
    return out.join(',');
  }

  // document.fonts.check()는 설치되지 않은 글꼴에도 true를 준다. 폭을 재서 판별한다.
  var probe=null;
  function available(name){
    if(!name || /^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/i.test(name)) return true;
    if(!probe) probe=document.createElement('canvas').getContext('2d');
    function w(font){
      probe.font='72px '+font;
      return probe.measureText('가나다라마바사아자차카타파하 Wgqm').width;
    }
    var quoted='"'+String(name).replace(/"/g,'')+'"';
    return w(quoted+', monospace')!==w('monospace') || w(quoted+', serif')!==w('serif');
  }

  // SVG의 font-family 속성을 계열에 맞는 사슬로 바꾼다.
  function rewriteSvg(html){
    if(!html) return html;
    return html.replace(/font-family="([^"]*)"/g, function(m, val){
      var first=val.split(',')[0].replace(/^['"]|['"]$/g,'').trim();
      if(!first) return m;
      return 'font-family="'+stack(first).replace(/"/g,'')+'"';
    });
  }

  // DOM에 이미 그려진 요소(hwp.js 결과 등)의 font-family도 사슬로 바꾼다.
  function applyToDom(root){
    if(!root) return;
    var styled=root.querySelectorAll('[style*="font-family"]');
    for(var i=0;i<styled.length;i++){
      var first=String(styled[i].style.fontFamily).split(',')[0].replace(/^['"]|['"]$/g,'').trim();
      if(first) styled[i].style.fontFamily=stack(first);
    }
    var attr=root.querySelectorAll('[font-family]');
    for(var j=0;j<attr.length;j++){
      var f=attr[j].getAttribute('font-family').split(',')[0].replace(/^['"]|['"]$/g,'').trim();
      if(f) attr[j].setAttribute('font-family', stack(f).replace(/"/g,''));
    }
  }

  function collectNames(root){
    var seen={}, out=[];
    function add(v){
      if(!v) return;
      var first=String(v).split(',')[0].replace(/^['"]|['"]$/g,'').trim();
      if(first && !seen[first.toLowerCase()]){ seen[first.toLowerCase()]=1; out.push(first); }
    }
    if(!root) return out;
    var svg=root.querySelectorAll('[font-family]');
    for(var i=0;i<svg.length;i++) add(svg[i].getAttribute('font-family'));
    var styled=root.querySelectorAll('[style*="font-family"]');
    for(var j=0;j<styled.length;j++) add(styled[j].style.fontFamily);
    return out;
  }

  // ---- 글꼴 파일에서 패밀리 이름 읽기 (.ttf/.otf/.ttc) ----
  function u16(d,o){ return (d[o]<<8)|d[o+1]; }
  function u32(d,o){ return ((d[o]<<24)|(d[o+1]<<16)|(d[o+2]<<8)|d[o+3])>>>0; }

  function familyFromFont(buf){
    var d=new Uint8Array(buf);
    if(d.length<12) return null;
    var base=0;
    if(d[0]===0x74&&d[1]===0x74&&d[2]===0x63&&d[3]===0x66){  // 'ttcf'
      if(d.length<16) return null;
      base=u32(d,12);
    }
    var numTables=u16(d,base+4);
    if(numTables<1||numTables>512) return null;
    var nameOff=-1;
    for(var i=0;i<numTables;i++){
      var rec=base+12+i*16;
      if(rec+16>d.length) break;
      if(d[rec]===0x6e&&d[rec+1]===0x61&&d[rec+2]===0x6d&&d[rec+3]===0x65){ // 'name'
        nameOff=u32(d,rec+8);
        break;
      }
    }
    if(nameOff<0||nameOff+6>d.length) return null;
    var count=u16(d,nameOff+2), strOff=nameOff+u16(d,nameOff+4);
    var best=null, bestScore=-1;
    for(var k=0;k<count;k++){
      var r=nameOff+6+k*12;
      if(r+12>d.length) break;
      var platform=u16(d,r), nameID=u16(d,r+6), len=u16(d,r+8), off=u16(d,r+10);
      if(nameID!==1&&nameID!==4&&nameID!==16) continue;
      var start=strOff+off;
      if(start+len>d.length) continue;
      var text='';
      if(platform===3||platform===0){
        for(var p=start;p+1<start+len;p+=2) text+=String.fromCharCode((d[p]<<8)|d[p+1]);
      } else {
        for(var q=start;q<start+len;q++) text+=String.fromCharCode(d[q]);
      }
      text=text.replace(/\u0000/g,'').trim();
      if(!text) continue;
      // 가변 글꼴은 nameID 1이 'Noto Sans KR Thin'처럼 굵기까지 포함한다. 16을 우선한다.
      var score=(nameID===16?6:nameID===1?4:2)+(platform===3?2:0);
      if(score>bestScore){ bestScore=score; best=text; }
    }
    return best;
  }

  var STYLE_WORDS=/\s+(regular|bold|light|thin|medium|semibold|semi bold|black|heavy|italic|oblique|book|roman)$/i;

  function familiesFromFont(buf){
    var name=familyFromFont(buf);
    var out=[];
    if(name){
      out.push(name);
      var base=name.replace(STYLE_WORDS,'').trim();
      if(base && base.toLowerCase()!==name.toLowerCase()) out.push(base);
    }
    return out;
  }

  var installed={};
  function installFile(file){
    return file.arrayBuffer().then(function(buf){
      var names=familiesFromFont(buf);
      var fallback=file.name.replace(/\.[^.]+$/,'');
      if(fallback && names.every(function(n){ return n.toLowerCase()!==fallback.toLowerCase(); })) names.push(fallback);
      if(!names.length) throw new Error('글꼴 이름을 읽지 못했습니다');
      var jobs=names.map(function(n){
        try{
          var face=new FontFace(n, buf, {style:'normal', weight:'400'});
          return face.load().then(function(loaded){ document.fonts.add(loaded); installed[n.toLowerCase()]=1; });
        }catch(e){ return Promise.reject(e); }
      });
      return Promise.all(jobs).then(function(){ return names; });
    });
  }

  window.HWPFonts={
    classify:classify,
    stack:stack,
    available:available,
    rewriteSvg:rewriteSvg,
    applyToDom:applyToDom,
    collectNames:collectNames,
    familyFromFont:familyFromFont,
    familiesFromFont:familiesFromFont,
    installFile:installFile,
    missing:function(root){
      return collectNames(root).filter(function(n){ return !available(n); });
    },
    installedCount:function(){ return Object.keys(installed).length; }
  };
})();
