// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs=require('node:fs'),path=require('node:path');
// Runner-neutral state extension: the engine includes its bytes in the same
// checkpoint inventory, corruption checks and last-consumer cleanup as backend state.
function withRuntimeState(provider,state) {
    if(!state)return provider;
    const lifecycle={
        capture:async directory=>{const snapshot=state.capture(provider);await provider.capture(directory);fs.writeFileSync(path.join(directory,'runner-state.json'),JSON.stringify(snapshot),{mode:0o600});},
        restore:async (directory,options)=>{await provider.restore(directory,options);await state.restore(JSON.parse(fs.readFileSync(path.join(directory,'runner-state.json'),'utf8')),provider);},
        reset:async()=>{await state.cleanup(provider);await provider.reset();},
        normalizedState:async()=>({application:await provider.normalizedState(),runner:state.capture(provider)}),
        cleanup:async()=>{let error;try{await state.cleanup(provider);}catch(cause){error=cause;}try{await provider.cleanup();}catch(cause){error=error?new AggregateError([error,cause],'Runner and backend cleanup failed'):cause;}if(error)throw error;},
    };
    return new Proxy(provider,{get:(target,key)=>Object.hasOwn(lifecycle,key)?lifecycle[key]:typeof target[key]==='function'?target[key].bind(target):target[key]});
}
module.exports={withRuntimeState};
