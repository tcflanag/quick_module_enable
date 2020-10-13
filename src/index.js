Hooks.once("ready", quick_enable_init)

async function quick_enable_init() {
    if (!game.user.isGM) return
    const history_size = 10
    var modVer = {};

    for (var mod of game.data.modules) modVer[mod.id] = {version: mod.data.version}
    
    game.settings.register('quick-module-enable', "previousModules", {
        scope: "world",
        type: Object,
        default: [],
        config: false,
        onChange: s => {}
    });    
     
    var modHistory = game.settings.get('quick-module-enable','previousModules')

    if (modHistory.length === 0) modHistory.push(modVer)
    while (modHistory.length <= history_size) modHistory.unshift(modHistory[0])
    while (modHistory.length > history_size) modHistory.shift()

    modHistory.shift() // Delete the oldest data
    modHistory.push(modVer) // Add this runs data to the stack
    await game.settings.set('quick-module-enable','previousModules',modHistory)

    ModuleManagement.prototype.realGetData = ModuleManagement.prototype.getData
    ModuleManagement.prototype.getData = getQuickEnableData

    var oldVer = modHistory.slice(-2)[0] // Second to last elemet is state at previous load
    for (mod of Object.keys(modVer)) {
        if (!(mod in oldVer)){
            var b = new ModuleManagement();
            b._filter = "recent"
            b.render(true);   
        } 
        if (mod in modHistory[0] && modVer[mod]["version"] !== modHistory[0][mod]["version"]){
            console.log("quick-module-enable - ",mod," version change from ",modHistory[0][mod]["version"]," to ",modVer[mod]["version"])
        }
    }   
}


function getQuickEnableData(options) {
    var data =this.realGetData(options)
    var counts_recent = 0    
    const modVer = game.settings.get('quick-module-enable','previousModules')[0] // Element 0 is oldest, so check it for version
    const newMod = game.settings.get('quick-module-enable','previousModules').slice(-2)[0] // Second to last elemet is state at previous load
    
    data.modules = data.modules.reduce((arr, m) => {

        var isNew =!(m.name in newMod)
        var isUpdated =!(m.name in modVer && modVer[m.name]["version"] === m.version)
        
        if (isUpdated || isNew) {
            counts_recent++;
            modVer[m.name] = {"version":m.version}
        }
                
        if (this._filter === "recent" && !(isUpdated||isNew)) return arr;          
        if (this._filter === "recent" && isNew) m.active = true

        return arr.concat([m]);
    }, []);

    data["filters"].push({id:"recent",
                            label: game.i18n.localize('QUICKMODMANAGE.FilterRecent'),
                            css: this._filter === "recent" ? " active" : "",
                            count: counts_recent})    
    return data
}

