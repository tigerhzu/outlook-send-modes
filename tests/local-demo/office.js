/** Browser-only mock. No Microsoft SDK, mailbox, or send capability is used. */
(() => {
  const key = 'company-local-demo-draft';
  const initial = {to:[{displayName:'測試收件者',emailAddress:'recipient@example.test'}],cc:[{displayName:'測試副本',emailAddress:'cc@example.test'}],subject:'原本的測試主旨',bodyHtml:'<p>這是原本的郵件內容。</p><p id="demo-signature">示範同仁<br>測試簽名</p><blockquote>原本的回覆歷史</blockquote>',bodyType:'html',properties:{},writes:[],sendCalls:0};
  let data;
  try { data = JSON.parse(sessionStorage.getItem(key)) || initial; } catch { data = initial; }
  window.__demoDraft = data;
  const update = () => {sessionStorage.setItem(key,JSON.stringify(data));parent.postMessage({type:'company-local-demo-draft',draft:data},location.origin);};
  const ok = (callback,value) => queueMicrotask(() => callback({status:'succeeded',value}));
  const write = (field,callback,action) => {action();data.writes.push(field);update();ok(callback);};
  const recipient = field => ({getAsync:callback=>ok(callback,structuredClone(data[field])),setAsync:(value,callback)=>write(field,callback,()=>{data[field]=structuredClone(value);}),addAsync:(value,callback)=>write(field,callback,()=>{data[field].push(...structuredClone(value));})});
  const item = {
    itemType:'message',to:recipient('to'),cc:recipient('cc'),
    subject:{getAsync:callback=>ok(callback,data.subject),setAsync:(value,callback)=>write('subject',callback,()=>{data.subject=value;})},
    body:{getTypeAsync:callback=>ok(callback,data.bodyType),getAsync:(_type,_options,callback)=>ok(callback,data.bodyHtml),prependAsync:(value,_options,callback)=>write('prepend',callback,()=>{data.bodyHtml=value+data.bodyHtml;}),setAsync:(value,_options,callback)=>write('body',callback,()=>{data.bodyHtml=value;})},
    loadCustomPropertiesAsync:callback=>ok(callback,{get:name=>data.properties[name],set:(name,value)=>{data.properties[name]=value;},remove:name=>{delete data.properties[name];},saveAsync:callback=>write('properties',callback,()=>{})}),
    getAttachmentsAsync:callback=>ok(callback,[]),
    sendAsync:()=>{data.sendCalls++;update();throw new Error('本地模擬禁止寄信。');},
  };
  const role = new URL(location.href).searchParams.get('demoRole') || 'reader';
  window.Office = {
    onReady:async()=>({host:'Outlook'}),HostType:{Outlook:'Outlook'},AsyncResultStatus:{Succeeded:'succeeded',Failed:'failed'},CoercionType:{Html:'html',Text:'text'},
    EventType:{ItemChanged:'itemChanged',DialogMessageReceived:'dialogMessageReceived',DialogEventReceived:'dialogEventReceived'},MailboxEnums:{ItemType:{Message:'message'},BodyMode:{HostConfig:'hostConfig'}},
    context:{requirements:{isSetSupported:()=>true},mailbox:{item,userProfile:{emailAddress:`local-${role}@example.test`},addHandlerAsync:(_event,_handler,callback)=>ok(callback)},
      ui:{displayDialogAsync:(url,_options,callback)=>{
        const channel = new URLSearchParams(new URL(url).hash.slice(1)).get('channel');
        let closed = false;
        callback({status:'succeeded',value:{close:()=>{closed=true;},addEventHandler:(type,handler)=>{
          if(type !== 'dialogMessageReceived')return;
          fetch(`/__demo/token?role=${encodeURIComponent(role)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',credentials:'omit',cache:'no-store'})
            .then(async response=>{if(!response.ok)throw new Error();return response.json();})
            .then(result=>{if(!closed)handler({origin:location.origin,message:JSON.stringify({channel,...result})});})
            .catch(()=>{if(!closed)handler({origin:location.origin,message:JSON.stringify({channel,error:'local-demo-login'})});});
        }}});
      }},
    },
  };
  addEventListener('DOMContentLoaded',update,{once:true});
})();
