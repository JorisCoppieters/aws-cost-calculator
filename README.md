# aws-cost-calculator

aws-cost-calculator is a Node utility for calculating the future cost of your AWS setup

### Installation

aws-cost-calculator requires [Node.js](https://nodejs.org/) v4+ to run.

Then:

```sh
$ npm install -g aws-cost-calculator
```

To run it, specifiy a schema file

```sh
$ acc --schema "MY_FILE"
```

Other options:
* ```--full```: To get a full report
* ```--buckets```: To print cost buckets
* ```--days [NUMBER]```: To specifiy the number of days to calculate over
* ```--nzd```: To display the price in NZD