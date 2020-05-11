const { config, CloudWatch, EC2, SharedIniFileCredentials } = require('aws-sdk')
const express = require('express')
const morgan = require('morgan')
const fs = require('fs')
const open = require('open')
const argv = require('yargs')
    .usage('Usage: $0 --region [str] --profile [str] --startTime [str] --endTime [str] --instance [str] --list')
    .argv

const app = express()
const port = process.env.PORT || "8080"
const ec2CPUUrl = 'http://localhost:8080/ec2_cpu.html'
let endTime = new Date()
let startTime = new Date()
startTime.setDate(endTime.getDate() - 1)

// Set the region
if (argv.region) {
    console.log('region: ' + argv.region)
    config.update({ region: argv.region })
} else {
    console.log('region: us-east-1')
    config.update({ region: 'us-east-1' })
}

// Set the account credentials
if (argv.profile) {
    const credentials = new SharedIniFileCredentials({ profile: argv.profile })
    config.credentials = credentials
    console.log('account: ' + argv.profile)
} else {
    console.log('account: default')
}

// Set period for data gathering
if (argv.startTime) {
    if (argv.endTime) {
        startTime = new Date(argv.startTime)
        endTime = new Date(argv.endTime)
        console.log('start time: ' + startTime)
        console.log('end time: ' + endTime)
    }
}

async function getEC2Instances() {
    let ec2 = new EC2({ apiVersion: '2016-11-15' })
    let ec2Parameters = {}
    const ec2InstanceIdList = []
    const ec2data = await ec2.describeInstances(ec2Parameters).promise()
    ec2data.Reservations.forEach((reservation) => {
        reservation.Instances.forEach((instance) => {
            ec2InstanceIdList.push(instance.InstanceId)
        })
    })
    console.log(ec2InstanceIdList.length + ' EC2 Instances found: ')
    console.log(ec2InstanceIdList)
    // later add...
    // instance class
    return ec2InstanceIdList
}

async function getCWMetrics(ec2Instance) {
    const metricsDataArray = []
    const cw = new CloudWatch({ apiVersion: '2010-08-01' })
    const cwParameters = {
        Dimensions: [
            {
                Name: 'InstanceId',
                Value: ec2Instance
            },
        ],
        MetricName: 'CPUUtilization',
        Namespace: 'AWS/EC2',
        Statistics: [
            'Average'
        ],
        Period: 3600,
        StartTime: startTime,
        EndTime: endTime
    }
    const cwdata = await cw.getMetricStatistics(cwParameters).promise()
    cwdata.Datapoints.forEach((metric) => {
        metricsDataArray.push(
            {
                x: metric.Timestamp,
                y: metric.Average
            }
        )
    })
    return {
        ec2Instance,
        metricsDataArray
    }
}

async function writeJSON(jsonFileData) {
    const jsonData = JSON.stringify(jsonFileData, null, 2);
    fs.writeFileSync(`./public/ec2_cpu_utilization.json`, jsonData)
}

getEC2Instances()
    .then((ec2InstanceIdList) => {
        if (!argv.list) {
            if (ec2InstanceIdList.includes(argv.instance)) {
                getCWMetrics(argv.instance)
                    .then((results) => writeJSON(results))
                    .then(() => {
                        app.use(express.static('public'))
                        app.use(morgan('common'))
                        // CORS
                        app.use(function (req, res, next) {
                            res.header('Access-Control-Allow-Origin', '*')
                            res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization')
                            res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE')
                            if (req.method === 'OPTIONS') {
                                return res.send(204)
                            }
                            next()
                        })
                        app.get('/', (request, res) => {
                            res.sendFile(__dirname + '/public/index.html')
                            res.status('200').json()
                        })
                        app.use(function (error, req, res, next) {
                            res.status(500).json({ message: error.message })
                        })
                        // catch-all endpoint if client makes request to non-existent endpoint
                        app.use('*', function (req, res) {
                            res.status(404).json({ message: 'Not Found' })
                        })
                        app.listen(port, () => {
                            console.log(`Listening to requests on http://localhost:${port}`)
                        })
                    })
                    .then(() => open(ec2CPUUrl))
                    .catch((err) => console.log(err))
            } else {
                console.log('Exiting.')
            }
        }
    })