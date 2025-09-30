"use strict";(self.webpackChunk_N_E=self.webpackChunk_N_E||[]).push([[5814],{24329:(e,t,l)=>{l.d(t,{A:()=>o});var r=l(63927),a=l(462);let o=(e,t)=>r.A.lang.round(a.A.parse(e)[t])},35134:(e,t,l)=>{l.d(t,{H:()=>a});var r=l(99445);function a(e,t){var l=e.append("foreignObject").attr("width","100000"),a=l.append("xhtml:div");a.attr("xmlns","http://www.w3.org/1999/xhtml");var o=t.label;switch(typeof o){case"function":a.insert(o);break;case"object":a.insert(function(){return o});break;default:a.html(o)}r.AV(a,t.labelStyle),a.style("display","inline-block"),a.style("white-space","nowrap");var n=a.node().getBoundingClientRect();return l.attr("width",n.width).attr("height",n.height),l}},85814:(e,t,l)=>{l.d(t,{diagram:()=>n});var r=l(71508),a=l(90596),o=l(89448);l(28541),l(28487),l(42086),l(87103),l(30832),l(91975),l(32831);let n={parser:r.p,db:r.f,renderer:a.f,styles:a.a,init:e=>{e.flowchart||(e.flowchart={}),e.flowchart.arrowMarkerAbsolute=e.arrowMarkerAbsolute,(0,o.p)({flowchart:{arrowMarkerAbsolute:e.arrowMarkerAbsolute}}),a.f.setConf(e.flowchart),r.f.clear(),r.f.setGen("gen-2")}}},90596:(e,t,l)=>{l.d(t,{a:()=>u,f:()=>f});var r=l(28541),a=l(35134),o=l(28487),n=l(64045),i=l(89448),s=l(24329),d=l(67608);let c={},p=async function(e,t,l,r,o,n){let s=r.select(`[id="${l}"]`);for(let l of Object.keys(e)){let r,d=e[l],c="default";d.classes.length>0&&(c=d.classes.join(" ")),c+=" flowchart-label";let p=(0,i.k)(d.styles),b=void 0!==d.text?d.text:d.id;if(i.l.info("vertex",d,d.labelType),"markdown"===d.labelType)i.l.info("vertex",d,d.labelType);else if((0,i.m)((0,i.c)().flowchart.htmlLabels)){let e={label:b};(r=(0,a.H)(s,e).node()).parentNode.removeChild(r)}else{let e=o.createElementNS("http://www.w3.org/2000/svg","text");for(let t of(e.setAttribute("style",p.labelStyle.replace("color:","fill:")),b.split(i.e.lineBreakRegex))){let l=o.createElementNS("http://www.w3.org/2000/svg","tspan");l.setAttributeNS("http://www.w3.org/XML/1998/namespace","xml:space","preserve"),l.setAttribute("dy","1em"),l.setAttribute("x","1"),l.textContent=t,e.appendChild(l)}r=e}let w=0,f="";switch(d.type){case"round":w=5,f="rect";break;case"square":case"group":default:f="rect";break;case"diamond":f="question";break;case"hexagon":f="hexagon";break;case"odd":case"odd_right":f="rect_left_inv_arrow";break;case"lean_right":f="lean_right";break;case"lean_left":f="lean_left";break;case"trapezoid":f="trapezoid";break;case"inv_trapezoid":f="inv_trapezoid";break;case"circle":f="circle";break;case"ellipse":f="ellipse";break;case"stadium":f="stadium";break;case"subroutine":f="subroutine";break;case"cylinder":f="cylinder";break;case"doublecircle":f="doublecircle"}let h=await (0,i.r)(b,(0,i.c)());t.setNode(d.id,{labelStyle:p.labelStyle,shape:f,labelText:h,labelType:d.labelType,rx:w,ry:w,class:c,style:p.style,id:d.id,link:d.link,linkTarget:d.linkTarget,tooltip:n.db.getTooltip(d.id)||"",domId:n.db.lookUpDomId(d.id),haveCallback:d.haveCallback,width:"group"===d.type?500:void 0,dir:d.dir,type:d.type,props:d.props,padding:(0,i.c)().flowchart.padding}),i.l.info("setNode",{labelStyle:p.labelStyle,labelType:d.labelType,shape:f,labelText:h,rx:w,ry:w,class:c,style:p.style,id:d.id,domId:n.db.lookUpDomId(d.id),width:"group"===d.type?500:void 0,type:d.type,dir:d.dir,props:d.props,padding:(0,i.c)().flowchart.padding})}},b=async function(e,t,l){let a,o;i.l.info("abc78 edges = ",e);let n=0,s={};if(void 0!==e.defaultStyle){let t=(0,i.k)(e.defaultStyle);a=t.style,o=t.labelStyle}for(let l of e){n++;let d="L-"+l.start+"-"+l.end;void 0===s[d]?s[d]=0:s[d]++,i.l.info("abc78 new entry",d,s[d]);let p=d+"-"+s[d];i.l.info("abc78 new link id to be used is",d,p,s[d]);let b="LS-"+l.start,w="LE-"+l.end,f={style:"",labelStyle:""};switch(f.minlen=l.length||1,"arrow_open"===l.type?f.arrowhead="none":f.arrowhead="normal",f.arrowTypeStart="arrow_open",f.arrowTypeEnd="arrow_open",l.type){case"double_arrow_cross":f.arrowTypeStart="arrow_cross";case"arrow_cross":f.arrowTypeEnd="arrow_cross";break;case"double_arrow_point":f.arrowTypeStart="arrow_point";case"arrow_point":f.arrowTypeEnd="arrow_point";break;case"double_arrow_circle":f.arrowTypeStart="arrow_circle";case"arrow_circle":f.arrowTypeEnd="arrow_circle"}let h="",u="";switch(l.stroke){case"normal":h="fill:none;",void 0!==a&&(h=a),void 0!==o&&(u=o),f.thickness="normal",f.pattern="solid";break;case"dotted":f.thickness="normal",f.pattern="dotted",f.style="fill:none;stroke-width:2px;stroke-dasharray:3;";break;case"thick":f.thickness="thick",f.pattern="solid",f.style="stroke-width: 3.5px;fill:none;";break;case"invisible":f.thickness="invisible",f.pattern="solid",f.style="stroke-width: 0;fill:none;"}if(void 0!==l.style){let e=(0,i.k)(l.style);h=e.style,u=e.labelStyle}f.style=f.style+=h,f.labelStyle=f.labelStyle+=u,void 0!==l.interpolate?f.curve=(0,i.n)(l.interpolate,r.lUB):void 0!==e.defaultInterpolate?f.curve=(0,i.n)(e.defaultInterpolate,r.lUB):f.curve=(0,i.n)(c.curve,r.lUB),void 0===l.text?void 0!==l.style&&(f.arrowheadStyle="fill: #333"):(f.arrowheadStyle="fill: #333",f.labelpos="c"),f.labelType=l.labelType,f.label=await (0,i.r)(l.text.replace(i.e.lineBreakRegex,"\n"),(0,i.c)()),void 0===l.style&&(f.style=f.style||"stroke: #333; stroke-width: 1.5px;fill:none;"),f.labelStyle=f.labelStyle.replace("color:","fill:"),f.id=p,f.classes="flowchart-link "+b+" "+w,t.setEdge(l.start,l.end,f,n)}},w=async function(e,t,l,a){let s,d;i.l.info("Drawing flowchart");let c=a.db.getDirection();void 0===c&&(c="TD");let{securityLevel:w,flowchart:f}=(0,i.c)(),h=f.nodeSpacing||50,u=f.rankSpacing||50;"sandbox"===w&&(s=(0,r.Ltv)("#i"+t));let g="sandbox"===w?(0,r.Ltv)(s.nodes()[0].contentDocument.body):(0,r.Ltv)("body"),y="sandbox"===w?s.nodes()[0].contentDocument:document,k=new o.T({multigraph:!0,compound:!0}).setGraph({rankdir:c,nodesep:h,ranksep:u,marginx:0,marginy:0}).setDefaultEdgeLabel(function(){return{}}),x=a.db.getSubGraphs();i.l.info("Subgraphs - ",x);for(let e=x.length-1;e>=0;e--)d=x[e],i.l.info("Subgraph - ",d),a.db.addVertex(d.id,{text:d.title,type:d.labelType},"group",void 0,d.classes,d.dir);let v=a.db.getVertices(),m=a.db.getEdges();i.l.info("Edges",m);let S=0;for(S=x.length-1;S>=0;S--){d=x[S],(0,r.Ubm)("cluster").append("text");for(let e=0;e<d.nodes.length;e++)i.l.info("Setting up subgraphs",d.nodes[e],d.id),k.setParent(d.nodes[e],d.id)}await p(v,k,t,g,y,a),await b(m,k);let T=g.select(`[id="${t}"]`),_=g.select("#"+t+" g");if(await (0,n.r)(_,k,["point","circle","cross"],"flowchart",t),i.u.insertTitle(T,"flowchartTitleText",f.titleTopMargin,a.db.getDiagramTitle()),(0,i.o)(k,T,f.diagramPadding,f.useMaxWidth),a.db.indexNodes("subGraph"+S),!f.htmlLabels)for(let e of y.querySelectorAll('[id="'+t+'"] .edgeLabel .label')){let t=e.getBBox(),l=y.createElementNS("http://www.w3.org/2000/svg","rect");l.setAttribute("rx",0),l.setAttribute("ry",0),l.setAttribute("width",t.width),l.setAttribute("height",t.height),e.insertBefore(l,e.firstChild)}Object.keys(v).forEach(function(e){let l=v[e];if(l.link){let a=(0,r.Ltv)("#"+t+' [id="'+e+'"]');if(a){let e=y.createElementNS("http://www.w3.org/2000/svg","a");e.setAttributeNS("http://www.w3.org/2000/svg","class",l.classes.join(" ")),e.setAttributeNS("http://www.w3.org/2000/svg","href",l.link),e.setAttributeNS("http://www.w3.org/2000/svg","rel","noopener"),"sandbox"===w?e.setAttributeNS("http://www.w3.org/2000/svg","target","_top"):l.linkTarget&&e.setAttributeNS("http://www.w3.org/2000/svg","target",l.linkTarget);let t=a.insert(function(){return e},":first-child"),r=a.select(".label-container");r&&t.append(function(){return r.node()});let o=a.select(".label");o&&t.append(function(){return o.node()})}}})},f={setConf:function(e){for(let t of Object.keys(e))c[t]=e[t]},addVertices:p,addEdges:b,getClasses:function(e,t){return t.db.getClasses()},draw:w},h=(e,t)=>{let l=s.A,r=l(e,"r"),a=l(e,"g"),o=l(e,"b");return d.A(r,a,o,t)},u=e=>`.label {
    font-family: ${e.fontFamily};
    color: ${e.nodeTextColor||e.textColor};
  }
  .cluster-label text {
    fill: ${e.titleColor};
  }
  .cluster-label span,p {
    color: ${e.titleColor};
  }

  .label text,span,p {
    fill: ${e.nodeTextColor||e.textColor};
    color: ${e.nodeTextColor||e.textColor};
  }

  .node rect,
  .node circle,
  .node ellipse,
  .node polygon,
  .node path {
    fill: ${e.mainBkg};
    stroke: ${e.nodeBorder};
    stroke-width: 1px;
  }
  .flowchart-label text {
    text-anchor: middle;
  }
  // .flowchart-label .text-outer-tspan {
  //   text-anchor: middle;
  // }
  // .flowchart-label .text-inner-tspan {
  //   text-anchor: start;
  // }

  .node .katex path {
    fill: #000;
    stroke: #000;
    stroke-width: 1px;
  }

  .node .label {
    text-align: center;
  }
  .node.clickable {
    cursor: pointer;
  }

  .arrowheadPath {
    fill: ${e.arrowheadColor};
  }

  .edgePath .path {
    stroke: ${e.lineColor};
    stroke-width: 2.0px;
  }

  .flowchart-link {
    stroke: ${e.lineColor};
    fill: none;
  }

  .edgeLabel {
    background-color: ${e.edgeLabelBackground};
    rect {
      opacity: 0.5;
      background-color: ${e.edgeLabelBackground};
      fill: ${e.edgeLabelBackground};
    }
    text-align: center;
  }

  /* For html labels only */
  .labelBkg {
    background-color: ${h(e.edgeLabelBackground,.5)};
    // background-color: 
  }

  .cluster rect {
    fill: ${e.clusterBkg};
    stroke: ${e.clusterBorder};
    stroke-width: 1px;
  }

  .cluster text {
    fill: ${e.titleColor};
  }

  .cluster span,p {
    color: ${e.titleColor};
  }
  /* .cluster div {
    color: ${e.titleColor};
  } */

  div.mermaidTooltip {
    position: absolute;
    text-align: center;
    max-width: 200px;
    padding: 2px;
    font-family: ${e.fontFamily};
    font-size: 12px;
    background: ${e.tertiaryColor};
    border: 1px solid ${e.border2};
    border-radius: 2px;
    pointer-events: none;
    z-index: 100;
  }

  .flowchartTitleText {
    text-anchor: middle;
    font-size: 18px;
    fill: ${e.textColor};
  }
`},99445:(e,t,l)=>{l.d(t,{AV:()=>d,De:()=>o,c$:()=>p,gh:()=>n,nh:()=>c});var r=l(56507),a=l(18708);function o(e,t){return!!e.children(t).length}function n(e){return s(e.v)+":"+s(e.w)+":"+s(e.name)}var i=/:/g;function s(e){return e?String(e).replace(i,"\\:"):""}function d(e,t){t&&e.attr("style",t)}function c(e,t,l){t&&e.attr("class",t).attr("class",l+" "+e.attr("class"))}function p(e,t){var l=t.graph();if(r.A(l)){var o=l.transition;if(a.A(o))return o(e)}return e}}}]);