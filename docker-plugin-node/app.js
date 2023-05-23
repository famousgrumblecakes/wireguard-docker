/*

    Node port of Riccardo P. Bestetti"s wireguard driver for docker.

*/

var express = require("express");
const { unlinkSync } = require('fs')
var app = express()

var middleware = (req, res, next)=>{
//horrible
    if(req.headers['content-length'] > 0)
    {
        var rawData = ""
        req.on('data', (chunk)=>{
            rawData = rawData + chunk.toString()
        })

        req.on('end', ()=>{
            req.body = JSON.parse(rawData)
            next()

        })
    }else
    {
        next()
    }
}

app.use(middleware)

const wgmanager = new (require("./wgmanager"))()

wgmanager.InitDB().then(()=>{
    console.log(`[wg driver]: storageinitialized!`)

    try {
        unlinkSync('/run/docker/plugins/wireguard.sock')
    } catch (error) {
        //no existing sock file, do nothing
    }

    app.listen("/run/docker/plugins/wireguard.sock", ()=>{
        console.log(`[wg driver]: listening!`)
    })
})

app.post("/Plugin.Activate", (req, res)=>{
    res.send({
        "Implements": ["NetworkDriver"]
    })
})

app.post("/NetworkDriver.GetCapabilities", (req, res)=>{
    res.send({
        "Scope": "local",
        "ConnectivityScope": "local"
    })
})

app.post("/NetworkDriver.CreateNetwork", (req, res)=>{

    var options = req.body["Options"]["com.docker.network.generic"]
    var id = req.body["NetworkID"]
    console.log(`[wg driver]: Creating network`)
    wgmanager.CreateNetwork(options, id).then((data)=>{
        res.send({})
    }).catch((err)=>{
        console.log(`[wg driver]: failed to create a network`)
    })
})

app.post("/NetworkDriver.DeleteNetwork", (req, res)=>{
    /*
        delete db["n"][req.NetworkID]    
    */

        var id = req.body["NetworkID"]

        wgmanager.DeleteNetwork(id).then(()=>{
            res.send({})
        }).catch((err)=>{
            //this network might not have existed or something, not sure
            console.log(`[wg driver]: error deleting network`)
        })
})

app.post("/NetworkDriver.CreateEndpoint", (req, res)=>{
    //Used by docker engine to add a container to a network, does not (verb)UP an interface on creation.
    console.log(`[wg driver]: Creating endpoint`)
    var address = req.body["Interface"]["Address"]
    var endpointID = req.body["EndpointID"]
    var networkID = req.body["NetworkID"]
    wgmanager.CreateContainerEndpoint(networkID, address, endpointID).then(()=>{
        console.log(`[wg driver]: Successfully created endpoint`)
        
        res.send({
            "Interface": {}
        })
    }).catch((err)=>{
        console.log(`[wg driver]: Failed to create endpoint`)
    })
})

app.post("/NetworkDriver.EndpointOperInfo", (req, res)=>{
    res.send({"Value": {}})
})

app.post("/NetworkDriver.DeleteEndpoint", (req, res)=>{

    wgmanager.DeleteEndpoint(req.body["NetworkID"], req.body["EndpointID"]).then(()=>{
        res.send({})
    }).catch((err)=>{
        console.log(`[wg driver]: ${err}`)
        res.send({})
    })
})

app.post("/NetworkDriver.Join", (req, res)=>{

    if(req.body["NetworkID"] && req.body["EndpointID"])
    {
        var networkID = req.body["NetworkID"]
        var endpointID = req.body["EndpointID"]

        wgmanager.Join(networkID, endpointID).then((ifname)=>{
            res.send({
                'InterfaceName': {
                    'SrcName': ifname,
                    'DstPrefix': 'wg'
                },
                'StaticRoutes': [{
                    'Destination': '0.0.0.0/0',
                     'RouteType': 1
                    }],
                'DisableGatewayService': true
            })
        }).catch((err)=>{
            console.log(err)
            console.log(`[wg driver]: failed to join network`)
        })
    }
})

app.post("/NetworkDriver.Leave", (req, res)=>{

    var networkID = req.body["NetworkID"]
    var endpointID = req.body["endpointID"]

    wgmanager.Leave(networkID, endpointID).then(()=>{
        res.send({})
        //wgmanager.UninstallInterface(ifname)
    }).catch((err)=>{
        console.log(err);
        res.send({})

    })


})

app.post("/NetworkDriver.DiscoverNew", (req, res)=>{
    //ignore
})

app.post("/NetworkDriver.DiscoverDelete", (req, res)=>{
    res.send({})
})

app.post("/Extended/CreateGateway", (req, res)=>{
    wgmanager.InstallGatewayInterface({
        Salt: req.Salt,
        Seed: req.Seed,
        Network:  req.Network //should be x.x.x.x/y format
    }).then((data)=>{
        res.send(data)
    })
})
