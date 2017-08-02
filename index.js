#!/usr/bin/env node

'use strict'; // JS: ES6

// ******************************
//
//
// AWS COST CALCULATOR v1.0.9
//
// 1.0.8
// - Added more instance types
// - Added schedule types
// - Added extra costs view
// - Small bug fix to to_decimal function
//
// 1.0.7
// - Fixed disable flags
//
// 1.0.6
// - Added better default to days
//
// 1.0.5
// - Adjusted package so this can be run as a standalone util
// - Improved help text
//
// 1.0.0
// - Initial release
//
// ******************************

// ******************************
// Requires:
// ******************************

let fs = require('fs');
let minimist = require('minimist');
let cprint = require('color-print');
let c = require('./src/constants');
let help = require('./src/help');

// ******************************
// Constants:
// ******************************

let STR_PAD_LEFT = '[STR_PAD_LEFT]';
let STR_PAD_RIGHT = '[STR_PAD_RIGHT]';

let INSTANCE_SCHEDULE_TEST_TAKE_DOWN = 'TEST_TAKE_DOWN';
let INSTANCE_SCHEDULE_MANUAL = 'MANUAL';
let INSTANCE_SCHEDULE_OFF = 'OFF';
let INSTANCE_SCHEDULE_24_7 = '24_7';

// ******************************
// Globals:
// ******************************

let g_INSTANCE_PRICES = {
  'spot': 0.019,

  't2.nano': 0.008,
  't2.micro': 0.016,
  't2.small': 0.032,
  't2.medium': 0.064,
  't2.large': 0.128,
  't2.xlarge': 0.256,
  't2.2xlarge': 0.512,
  'm4.large': 0.125,
  'm4.xlarge': 0.25,
  'm4.2xlarge': 0.5,
  'm4.4xlarge': 1,
  'm4.10xlarge': 2.5,
  'm4.16xlarge': 4,
  'm3.medium': 0.093,
  'm3.large': 0.186,
  'm3.xlarge': 0.372,
  'm3.2xlarge': 0.745,

  'c4.large': 0.13,
  'c4.xlarge': 0.261,
  'c4.2xlarge': 0.522,
  'c4.4xlarge': 1.042,
  'c4.8xlarge': 2.085,
  'c3.large': 0.132,
  'c3.xlarge': 0.265,
  'c3.2xlarge': 0.529,
  'c3.4xlarge': 1.058,
  'c3.8xlarge': 2.117,

  'p2.xlarge': 1.542,
  'p2.8xlarge': 12.336,
  'p2.16xlarge': 24.672,
  'g2.2xlarge': 0.898,
  'g2.8xlarge': 3.592,

  'x1.16xlarge': 9.671,
  'x1.32xlarge': 19.341,
  'r3.large': 0.2,
  'r3.xlarge': 0.399,
  'r3.2xlarge': 0.798,
  'r3.4xlarge': 1.596,
  'r3.8xlarge': 3.192,
  'r4.large': 0.16,
  'r4.xlarge': 0.319,
  'r4.2xlarge': 0.638,
  'r4.4xlarge': 1.277,
  'r4.8xlarge': 2.554,
  'r4.16xlarge': 5.107,

  'i3.large': 0.187,
  'i3.xlarge': 0.374,
  'i3.2xlarge': 0.748,
  'i3.4xlarge': 1.496,
  'i3.8xlarge': 2.992,
  'i3.16xlarge': 5.984,
  'd2.xlarge': 0.87,
  'd2.2xlarge': 1.74,
  'd2.4xlarge': 3.48,
  'd2.8xlarge': 6.96
};

let g_STORAGE_PRICES = {
  'gp2': 0.12, // Per Gb-month
  'snapshot': 0.055 // Per Gb-month
};

let g_INSTANCE_SPOT_CHANCES = {
  't2.micro': 0.74,
  't2.small': 0.81,
  't2.medium': 0.88,
  'c4.large': 0.935
};

let g_ELB_PER_HOUR = 0.028;
let g_NAT_PER_HOUR = 0.059;
let g_NAT_PER_GB = 0.059;

let g_USD_EXCHANGE_RATE = 0.7008;
let g_DAYS_IN_MONTH = 31;
let g_DAY_OF_MONTH = new Date().getDate();

let g_ENABLE_SPOT_PRICING = true;
let g_ENABLE_TAKE_DOWN = true;
let g_ENABLE_FREE_TIER = true;

let g_FREE_SSD_STORAGE = 30;
let g_FREE_MICRO_INSTANCE_HOURS = 750;
let g_FREE_ELB_HOURS = 750;

let g_BUCKETS = {};

// ******************************
// Arguments:
// ******************************

let g_ARGV = minimist(process.argv.slice(2));

// ******************************
// Script:
// ******************************

if (g_ARGV['help']) {
    help.printHelp();
} else if (g_ARGV['version']) {
    help.printVersion();
} else {
    let schema = g_ARGV['schema'];
    let num_days = g_ARGV['days'] || g_DAY_OF_MONTH;
    let full_report = g_ARGV['full'];
    let spot_pricing = g_ARGV['spot-pricing'];
    let take_down = g_ARGV['take-down'];
    let free_tier = g_ARGV['free-tier'];

    if (!schema) {
        help.printHelp('Please specifiy a schema');
    } else {
        printAwsCosts(schema, num_days, full_report, spot_pricing, take_down, free_tier);
    }
}

// ******************************
// Functions:
// ******************************

function printAwsCosts (in_schema, in_num_days, in_full_report, in_spot_pricing, in_take_down, in_free_tier) {
    calculateBucketValues(in_schema, in_num_days, in_full_report, in_spot_pricing, in_take_down, in_free_tier);
    printCosts('ALL', in_num_days, in_full_report);

    let tot = 0;

    Object.keys(g_BUCKETS).forEach(b => {
      if (b === 'ALL') {
        return;
      }
      let total_usd = getBucketValue(b, 'total_usd');
      tot += total_usd;
      console.log(total_usd);
    });

    console.log(tot);
}

// ******************************

function calculateBucketValues (in_schema, in_num_days, in_full_report, in_spot_pricing, in_take_down, in_free_tier) {
    do
    {
        if (!fs.existsSync(in_schema)) {
            cprint.yellow('Failed to load schema: ' + in_schema);
        }
        let services = require(in_schema);
        if (!services) {
            cprint.yellow('Failed to load schema: ' + in_schema);
        }

        set_instance_spot_chances(services);
        set_instance_prices(services);

        g_ENABLE_SPOT_PRICING = in_spot_pricing !== false;
        g_ENABLE_TAKE_DOWN = in_take_down !== false;
        g_ENABLE_FREE_TIER = in_free_tier !== false;

        let general_bucket = 'ALL';

        let months = parseInt(in_num_days / g_DAYS_IN_MONTH + 0.99999);

        if (g_ENABLE_FREE_TIER)
        {
            setBucketValue(general_bucket, 'period_storage_hours', -g_FREE_SSD_STORAGE * 24 * g_DAYS_IN_MONTH * months); // Free storage
            setBucketArrayValue(general_bucket, 'period_instance_type_hours', 't2.micro', -g_FREE_MICRO_INSTANCE_HOURS * months); // Free micro usage
        }

        Object.keys(services).forEach(service => {
            let service_config = services[service];
            let type = jlib_get_property(service_config, 'type', false);
            let bucket = jlib_get_property(service_config, 'bucket', 'unknown');

            if (service === '__config')
            {
                return;
            }

            if (type === 'nat')
            {
                let nat_configs = jlib_get_property(service_config, 'configs', []);
                nat_configs.forEach(nat_config => {
                    let nat_hours_per_day = jlib_get_property(nat_config, 'hours_per_day', 24);
                    let nat_days_per_week = jlib_get_property(nat_config, 'days_per_week', 7);
                    let nat_extra_hours = jlib_get_property(nat_config, 'extra_hours', 0);
                    let nat_uptime_hours = in_num_days * (nat_days_per_week / 7) * nat_hours_per_day + nat_extra_hours;
                    let inc_period_nat_hourly = nat_uptime_hours;
                    let inc_period_nat_gb = jlib_get_property(nat_config, 'data_transfer', 0) * in_num_days;

                    incBucketValue(general_bucket, 'period_nat_hourly', inc_period_nat_hourly);
                    incBucketValue(bucket, 'period_nat_hourly', inc_period_nat_hourly);

                    incBucketValue(general_bucket, 'period_nat_gb', inc_period_nat_gb);
                    incBucketValue(bucket, 'period_nat_gb', inc_period_nat_gb);
                });
                return;
            }

            if (type === 'simple')
            {
                let hourly_rate = jlib_get_property(service_config, 'per_hour', 0);
                let monthly_rate = jlib_get_property(service_config, 'per_month', 0);
                hourly_rate += monthly_rate / (g_DAYS_IN_MONTH * 24);

                let extra_cost = hourly_rate * in_num_days * 24;

                incBucketValue(general_bucket, 'extra_costs', extra_cost);
                incBucketValue(bucket, 'extra_costs', extra_cost);

                setBucketArrayValue(general_bucket, 'extra_cost_lines', service, extra_cost);
                setBucketArrayValue(bucket, 'extra_cost_lines', service, extra_cost);
                return;
            }

            let service_instances = [];
            let period_elb_inc = 0;

            let dev_config = jlib_get_property(service_config, 'dev', false);
            if (dev_config)
            {
                let dev_instances = jlib_get_property(dev_config, 'instances', []);
                service_instances = service_instances.concat(dev_instances);

                if (jlib_get_property(dev_config, 'elb'))
                    period_elb_inc += 24 * in_num_days;
            }

            let test_config = jlib_get_property(service_config, 'test', false);
            if (test_config)
            {
                let test_instances = jlib_get_property(test_config, 'instances', []);
                service_instances = service_instances.concat(test_instances);

                if (jlib_get_property(test_config, 'elb'))
                    period_elb_inc += 24 * in_num_days;
            }

            let prod_config = jlib_get_property(service_config, 'prod', false);
            if (prod_config)
            {
                let prod_instances = jlib_get_property(prod_config, 'instances', []);
                service_instances = service_instances.concat(prod_instances);

                if (jlib_get_property(prod_config, 'elb'))
                    period_elb_inc += 24 * in_num_days;
            }

            incBucketValue(general_bucket, 'period_elb', period_elb_inc);
            incBucketValue(bucket, 'period_elb', period_elb_inc);

            service_instances.forEach(instance_config => {
                let instance_type = jlib_get_property(instance_config, 'type', 't2.micro');

                let instance_gp2_storage = jlib_get_property(instance_config, 'ssd', 0);
                let instance_ebs_storage = jlib_get_property(instance_config, 'ebs', 0);
                let instance_storage = instance_gp2_storage + instance_ebs_storage;

                let instance_extra_hours = jlib_get_property(instance_config, 'extra_hours', 0);
                let instance_hours_per_day = jlib_get_property(instance_config, 'hours_per_day', 0);
                let instance_days_per_week = jlib_get_property(instance_config, 'days_per_week', 0);
                let instance_schedule = jlib_get_property(instance_config, 'schedule', false);

                incBucketArrayValue(general_bucket, 'period_instance_type_number', instance_type, 1);
                incBucketArrayValue(bucket, 'period_instance_type_number', instance_type, 1);

                if (instance_schedule == INSTANCE_SCHEDULE_OFF)
                {
                    instance_hours_per_day = 0;
                    instance_days_per_week = 0;
                }
                else if (instance_schedule == INSTANCE_SCHEDULE_24_7)
                {
                    instance_hours_per_day = 24;
                    instance_days_per_week = 7;
                }
                else if (instance_schedule == INSTANCE_SCHEDULE_TEST_TAKE_DOWN)
                {
                    if (g_ENABLE_TAKE_DOWN)
                    {
                        instance_hours_per_day = 14;
                        instance_days_per_week = 5;
                    }
                    else
                    {
                        instance_hours_per_day = 24;
                        instance_days_per_week = 7;
                    }
                }

                let instance_uptime_hours = in_num_days * (instance_days_per_week / 7) * instance_hours_per_day + instance_extra_hours;
                let period_storage_hours_inc = instance_storage * instance_uptime_hours;

                incBucketValue(general_bucket, 'period_storage_hours', period_storage_hours_inc);
                incBucketValue(bucket, 'period_storage_hours', period_storage_hours_inc);

                let period_instance_on_demand_hours = instance_uptime_hours;
                let period_instance_spot_hours = 0;

                if (jlib_get_property(instance_config, 'spot', false) && g_ENABLE_SPOT_PRICING)
                {
                    let instance_price = get_instance_price(instance_type);
                    let spot_instance_price = get_instance_price('spot');
                    if (spot_instance_price < instance_price)
                    {
                        incBucketArrayValue(general_bucket, 'period_instance_type_number', 'spot', 1);
                        incBucketArrayValue(bucket, 'period_instance_type_number', 'spot', 1);

                        let instance_spot_chance = get_instance_spot_chance(instance_type);
                        period_instance_on_demand_hours = (1 - instance_spot_chance) * instance_uptime_hours;
                        period_instance_spot_hours = instance_spot_chance * instance_uptime_hours;
                    }
                }

                incBucketArrayValue(general_bucket, 'period_instance_type_hours', instance_type, period_instance_on_demand_hours);
                incBucketArrayValue(bucket, 'period_instance_type_hours', instance_type, period_instance_on_demand_hours);

                if (period_instance_spot_hours > 0)
                {
                    incBucketArrayValue(general_bucket, 'period_instance_type_hours', 'spot', period_instance_spot_hours);
                    incBucketArrayValue(bucket, 'period_instance_type_hours', 'spot', period_instance_spot_hours);
                }
            });
        });

        if (g_ENABLE_FREE_TIER)
        {
            setBucketValue(general_bucket, 'period_storage_hours', Math.max(0,
                getBucketValue(general_bucket, 'period_storage_hours')));

            setBucketArrayValue(general_bucket, 'period_instance_type_hours', 't2.micro', Math.max(0,
                getBucketArrayValue(general_bucket, 'period_instance_type_hours', 't2.micro')));
        }

        Object.keys(g_BUCKETS).forEach(b => {
            calculateCostsForBucket(b);
        });
    }
    while (false);
}

// ******************************

function calculateCostsForBucket (in_bucket) {
    do
    {
        let period_elb = getBucketValue(in_bucket, 'period_elb') || 0;
        let period_nat_gb = getBucketValue(in_bucket, 'period_nat_gb') || 0;
        let period_nat_hourly = getBucketValue(in_bucket, 'period_nat_hourly') || 0;
        let period_storage_hours = getBucketValue(in_bucket, 'period_storage_hours') || 0;
        let period_instance_type_hours = getBucketValue(in_bucket, 'period_instance_type_hours') || [];
        let period_instance_type_number = getBucketValue(in_bucket, 'period_instance_type_number') || [];
        let extra_costs = getBucketValue(in_bucket, 'extra_costs') || 0;
        let extra_cost_lines = getBucketValue(in_bucket, 'extra_cost_lines') || [];

        let hourly_storage_cost = get_storage_price('gp2') / (24 * 30);
        let period_storage_cost = period_storage_hours * hourly_storage_cost;

        let period_nat_hourly_cost = period_nat_hourly * g_NAT_PER_HOUR;
        let period_nat_gb_cost = period_nat_gb * g_NAT_PER_GB;
        let period_nat_cost = period_nat_hourly_cost + period_nat_gb_cost;

        period_instance_type_hours = sort_instances_array(period_instance_type_hours);
        setBucketValue(in_bucket, 'period_instance_type_hours', period_instance_type_hours);

        period_instance_type_number = sort_instances_array(period_instance_type_number);
        setBucketValue(in_bucket, 'period_instance_type_number', period_instance_type_number);

        let period_instance_type_costs = [];
        Object.keys(period_instance_type_hours).forEach(instance_type => {
            let instance_hours = period_instance_type_hours[instance_type];
            period_instance_type_costs[instance_type] = get_instance_price(instance_type) * instance_hours;
        });

        let total_period_instance_type_costs = object_values(period_instance_type_costs).reduce(function (a, b) { return a + b; }, 0);

        let period_elb_hours = Math.max(0, period_elb - g_FREE_ELB_HOURS);
        let period_elb_cost = period_elb_hours * g_ELB_PER_HOUR;

        let subtotal = total_period_instance_type_costs +
            period_elb_cost +
            period_nat_cost +
            period_storage_cost;

        let gst = (subtotal + extra_costs) * 0.15;

        let total_usd = subtotal + extra_costs + gst;

        setBucketValue(in_bucket, 'extra_cost_lines', extra_cost_lines || []);
        setBucketValue(in_bucket, 'extra_costs', extra_costs || 0);
        setBucketValue(in_bucket, 'gst', gst || 0);
        setBucketValue(in_bucket, 'hourly_storage_cost', hourly_storage_cost || 0);
        setBucketValue(in_bucket, 'period_elb', period_elb || 0);
        setBucketValue(in_bucket, 'period_elb_cost', period_elb_cost || 0);
        setBucketValue(in_bucket, 'period_elb_hours', period_elb_hours || 0);
        setBucketValue(in_bucket, 'period_instance_type_costs', period_instance_type_costs || []);
        setBucketValue(in_bucket, 'period_instance_type_hours', period_instance_type_hours || []);
        setBucketValue(in_bucket, 'period_instance_type_number', period_instance_type_number || []);
        setBucketValue(in_bucket, 'period_nat_cost', period_nat_cost || 0);
        setBucketValue(in_bucket, 'period_nat_gb', period_nat_gb || 0);
        setBucketValue(in_bucket, 'period_nat_gb_cost', period_nat_gb_cost || 0);
        setBucketValue(in_bucket, 'period_nat_hourly', period_nat_hourly || 0);
        setBucketValue(in_bucket, 'period_nat_hourly_cost', period_nat_hourly_cost || 0);
        setBucketValue(in_bucket, 'period_storage_cost', period_storage_cost || 0);
        setBucketValue(in_bucket, 'period_storage_hours', period_storage_hours || 0);
        setBucketValue(in_bucket, 'subtotal', subtotal || 0);
        setBucketValue(in_bucket, 'total_period_instance_type_costs', total_period_instance_type_costs || 0);
        setBucketValue(in_bucket, 'total_usd', total_usd || 0);
    }
    while (false);
}

// ******************************

function printCosts (in_bucket, in_num_days, in_full_report) {
    let extra_cost_lines = getBucketValue(in_bucket, 'extra_cost_lines');
    let extra_costs = getBucketValue(in_bucket, 'extra_costs');
    let gst = getBucketValue(in_bucket, 'gst');
    let hourly_storage_cost = getBucketValue(in_bucket, 'hourly_storage_cost');
    let period_elb = getBucketValue(in_bucket, 'period_elb');
    let period_elb_cost = getBucketValue(in_bucket, 'period_elb_cost');
    let period_elb_hours = getBucketValue(in_bucket, 'period_elb_hours');
    let period_instance_type_costs = getBucketValue(in_bucket, 'period_instance_type_costs');
    let period_instance_type_hours = getBucketValue(in_bucket, 'period_instance_type_hours');
    let period_instance_type_number = getBucketValue(in_bucket, 'period_instance_type_number');
    let period_nat_cost = getBucketValue(in_bucket, 'period_nat_cost');
    let period_nat_gb = getBucketValue(in_bucket, 'period_nat_gb');
    let period_nat_gb_cost = getBucketValue(in_bucket, 'period_nat_gb_cost');
    let period_nat_hourly = getBucketValue(in_bucket, 'period_nat_hourly');
    let period_nat_hourly_cost = getBucketValue(in_bucket, 'period_nat_hourly_cost');
    let period_storage_cost = getBucketValue(in_bucket, 'period_storage_cost');
    let period_storage_hours = getBucketValue(in_bucket, 'period_storage_hours');
    let subtotal = getBucketValue(in_bucket, 'subtotal');
    let total_period_instance_type_costs = getBucketValue(in_bucket, 'total_period_instance_type_costs');
    let total_usd = getBucketValue(in_bucket, 'total_usd');

    let col_1 = [];

    if (in_full_report)
    {
        let col_1_col_1 = [];
        col_1_col_1.push(cprint.toCyan('INSTANCE TYPE', true));
        Object.keys(period_instance_type_costs).forEach(instance_type => {
            let instance_type_cost = period_instance_type_costs[instance_type];
            col_1_col_1.push(cprint.toWhite('- ' + instance_type, true));
        });
        col_1_col_1.push(cprint.toCyan('TOTAL', true));

        let col_1_col_2 = [];

        col_1_col_2.push(cprint.toCyan('NUMBER', true));
        let total_instance_number = 0;
        Object.keys(period_instance_type_number).forEach(instance_type => {
            let instance_type_number = period_instance_type_number[instance_type];
            total_instance_number += instance_type_number;
            col_1_col_2.push(cprint.toLightGray(instance_type_number, true));
        });
        col_1_col_2.push(cprint.toWhite(total_instance_number, true));

        let col_1_col_3 = [];

        col_1_col_3.push(cprint.toCyan('HOURS', true));
        let total_instance_hours = 0;
        let max_hour_length = object_values(period_instance_type_hours).reduce((a,b) => { return Math.max(color_line_length(to_decimal(b)), a); }, 0) - 2;
        Object.keys(period_instance_type_hours).forEach(instance_type => {
            let instance_type_hours = period_instance_type_hours[instance_type];
            total_instance_hours += instance_type_hours;
            col_1_col_3.push(cprint.toLightGray(to_decimal(instance_type_hours, max_hour_length) + ' h', true));
        });
        col_1_col_3.push(cprint.toWhite(to_decimal(total_instance_hours, max_hour_length) + ' h', true));

        let col_1_col_4 = [];

        col_1_col_4.push(cprint.toCyan('COST', true));
        let total_instance_cost = 0;
        let max_price_length = object_values(period_instance_type_costs).reduce((a,b) => { return Math.max(color_line_length(to_usd(b)) - 6, a); }, 0);
        Object.keys(period_instance_type_costs).forEach(instance_type => {
            let instance_type_cost = period_instance_type_costs[instance_type];
            total_instance_cost += instance_type_cost;
            col_1_col_4.push(cprint.toYellow(to_usd(instance_type_cost, max_price_length), true));
        });
        col_1_col_4.push(cprint.toLightYellow(to_usd(total_instance_cost, max_price_length), true));

        col_1 = combine_columns(col_1, col_1_col_1, 0);
        col_1 = combine_columns(col_1, col_1_col_2, 5);
        col_1 = combine_columns(col_1, col_1_col_3, 5);
        col_1 = combine_columns(col_1, col_1_col_4, 5);
        col_1.push('');
    }

    col_1.push(cprint.toCyan('SUBTOTAL: ', true) + cprint.toYellow(to_usd(subtotal), true));
    col_1.push(cprint.toCyan('EXTRA COSTS: ', true) + cprint.toYellow(to_usd(extra_costs), true));
    col_1.push(cprint.toCyan('GST: ', true) + cprint.toYellow(to_usd(gst), true));
    col_1.push(cprint.toCyan('TOTAL USD: ', true) + cprint.toYellow(to_usd(total_usd), true));
    col_1.push('');
    col_1.push(cprint.toLightCyan('TOTAL NZD: ', true) + cprint.toLightYellow(to_nzd(total_usd), true));

    let col_2 = [];
    if (in_full_report)
    {
        col_2.push(cprint.toCyan('NAT UPTIME:', true));
        col_2.push('  ' + cprint.toLightGray(to_decimal(period_nat_hourly, 0), true) + ' h - ' + cprint.toYellow(to_usd(period_nat_hourly_cost, 0), true));
        col_2.push('');
        col_2.push(cprint.toCyan('NAT DATA TRANSFER:', true));
        col_2.push('  ' + cprint.toLightGray(to_decimal(period_nat_gb, 0), true) + ' Gbs - ' + cprint.toYellow(to_usd(period_nat_gb_cost, 0), true));
        col_2.push('');
        col_2.push(cprint.toCyan('EXTRA COSTS:', true));
        Object.keys(extra_cost_lines).forEach((service, idx) => {
            if (idx % 2 !== 0 || idx > 5) {
                return;
            }
            let extra_cost_line = extra_cost_lines[service];
            col_2.push('  ' + cprint.toLightGray(service, true) + ' - ' + cprint.toYellow(to_usd(extra_cost_line, 0), true));
        });
    }

    let col_3 = [];
    if (in_full_report)
    {
        col_3.push(cprint.toCyan('LOAD BALANCING UPTIME:', true));
        col_3.push('  ' + cprint.toLightGray(to_decimal(period_elb, 0), true) + ' h - ' + cprint.toYellow(to_usd(period_elb_cost, 0), true));
        col_3.push('');
        col_3.push(cprint.toCyan('STORAGE:', true));
        col_3.push('  ' + cprint.toLightGray(to_decimal(period_storage_hours, 0), true) + ' Gbs - ' + cprint.toYellow(to_usd(period_storage_cost, 0), true));
        col_3.push('');
        col_3.push('');
        Object.keys(extra_cost_lines).forEach((service, idx) => {
            if (idx % 2 !== 1 || idx > 5) {
                return;
            }
            let extra_cost_line = extra_cost_lines[service];
            col_3.push('  ' + cprint.toLightGray(service, true) + ' - ' + cprint.toYellow(to_usd(extra_cost_line, 0), true));
        });
    }

    let lines = [];
    lines = combine_columns(lines, col_1, 0);
    lines = combine_columns(lines, col_2, 6);
    lines = combine_columns(lines, col_3, 6);

    let title = 'OVER ' + in_num_days + ' DAY' + (in_num_days === 1 ? '' : 'S');

    lines.unshift('');
    lines.unshift(cprint.toMagenta('-'.repeat(title.length), true));
    lines.unshift(cprint.toMagenta(title, true));

    let terminal_width = getTerminalWidth();

    let output = '';
    output += cprint.toMagenta('/' + '-'.repeat(terminal_width - 2) + '\\') + '\n';
    let padded_line_length = terminal_width - 4;
    lines.forEach(line => {
        let line_length = color_line_length(line);
        let padding = ' '.repeat(Math.max(0, padded_line_length - line_length + 1));

        output += cprint.toMagenta('|', 'MAGENTA') + ' ' + line + padding + cprint.toMagenta('|') + '\n';
    });
    output += cprint.toMagenta('\\' + '-'.repeat(terminal_width - 2) + '/') + '\n';

    console.log(output);
}

// ******************************

function getTerminalWidth () {
    let terminal_width = 136; // TODO
    return terminal_width;
}

// ******************************

function getBucket (in_bucket) {
    if (!g_BUCKETS[in_bucket]) {
        g_BUCKETS[in_bucket] = {};
    }
    return g_BUCKETS[in_bucket];
}

// ******************************

function getBucketValue (in_bucket, in_key) {
    let bucket = getBucket(in_bucket);
    return bucket[in_key];
}

// ******************************

function getBucketArrayValue (in_bucket, in_key, in_idx) {
    let bucketArrayValue = getBucketValue(in_bucket, in_key) || [];
    return bucketArrayValue[in_idx];
}

// ******************************

function setBucketValue (in_bucket, in_key, in_val) {
    let bucket = getBucket(in_bucket);
    bucket[in_key] = in_val;
}

// ******************************

function incBucketValue (in_bucket, in_key, in_inc) {
    let bucketValue = parseFloat(getBucketValue(in_bucket, in_key)) || 0;
    setBucketValue(in_bucket, in_key, bucketValue + parseFloat(in_inc));
}

// ******************************

function setBucketArrayValue (in_bucket, in_key, in_idx, in_val) {
    let bucketArrayValue = getBucketValue(in_bucket, in_key) || [];
    bucketArrayValue[in_idx] = in_val;
    setBucketValue(in_bucket, in_key, bucketArrayValue);
}

// ******************************

function incBucketArrayValue (in_bucket, in_key, in_idx, in_inc) {
    let bucketArrayValue = getBucketValue(in_bucket, in_key) || [];
    bucketArrayValue[in_idx] = (parseFloat(bucketArrayValue[in_idx]) || 0) + parseFloat(in_inc);
    setBucketValue(in_bucket, in_key, bucketArrayValue);
}

// ******************************

function jlib_get_property (in_object, in_key, in_default_val) {
    return (in_object[in_key] !== undefined) ? in_object[in_key] : in_default_val;
}

// ******************************

function get_storage_price(in_storage_type)
{
    let result = false;

    do
    {
        if (!g_STORAGE_PRICES[in_storage_type])
        {
            result = 0;
            break;
        }

        result = g_STORAGE_PRICES[in_storage_type];
    }
    while (false);

    return result;
}

// ******************************

function get_instance_price(in_instance_type)
{
    let result = false;

    do
    {
        if (!g_INSTANCE_PRICES[in_instance_type])
        {
            result = 0;
            break;
        }

        result = g_INSTANCE_PRICES[in_instance_type];
    }
    while (false);

    return result;
}

// ******************************

function set_instance_prices(in_schema)
{
    let result = false;

    do
    {
        let config = jlib_get_property(in_schema, '__config', {});
        let prices = jlib_get_property(config, 'prices', {});
        Object.keys(prices).forEach(instance_type => {
            let price = prices[instance_type];
            g_INSTANCE_PRICES[instance_type] = price;
        });
    }
    while (false);

    return result;
}

// ******************************

function get_instance_spot_chance(in_instance_type)
{
    let result = false;

    do
    {
        if (!g_INSTANCE_SPOT_CHANCES[in_instance_type])
        {
            result = 0;
            break;
        }

        result = g_INSTANCE_SPOT_CHANCES[in_instance_type];
    }
    while (false);

    return result;
}

// ******************************

function set_instance_spot_chances(in_schema)
{
    let result = false;

    do
    {
        let config = jlib_get_property(in_schema, '__config', {});
        let spot_chances = jlib_get_property(config, 'spot_chances', {});
        Object.keys(spot_chances).forEach(instance_type => {
            let spot_chance = spot_chances[instance_type];
            g_INSTANCE_SPOT_CHANCES[instance_type] = spot_chance;
        });
    }
    while (false);

    return result;
}

// ******************************

function sort_instances_array(in_instances_array)
{
    let result = false;

    do
    {
        let keysSorted = Object.keys(in_instances_array).sort((a,b) => {
            function instanceRank(instance){
                return Object.keys(g_INSTANCE_PRICES).indexOf(instance);
            }
            return instanceRank(a) - instanceRank(b);
        });

        result = {};
        keysSorted.forEach(function (key) {
            let val = in_instances_array[key];
            result[key] = val;
        });
    }
    while (false);

    return result;
}

// ******************************

function object_values (in_object) {
    let values = [];
    Object.keys(in_object).forEach(key => {
        values.push(in_object[key]);
    });
    return values;
}

// ******************************

function to_usd(in_number, in_col_width)
{
    in_col_width = typeof(in_col_width) === 'undefined' ? 3 : in_col_width;

    return 'USD ' + to_decimal(in_number, in_col_width);
}

// ******************************

function to_nzd(in_number, in_col_width)
{
    in_col_width = typeof(in_col_width) === 'undefined' ? 3 : in_col_width;

    return 'NZD ' + to_decimal(in_number / g_USD_EXCHANGE_RATE, in_col_width);
}

// ******************************

function to_decimal(in_number, in_col_width)
{
    in_col_width = typeof(in_col_width) === 'undefined' ? 3 : in_col_width;

    let int_val = parseInt(in_number);
    let decimal_val = parseInt((in_number - int_val) * 100 + 0.5);
    return str_pad(int_val + '.' + str_pad(decimal_val, 2, '0').substring(0, 2), in_col_width + 3, ' ', STR_PAD_LEFT);
}

// ******************************

function str_pad(in_string, in_pad_amount, in_pad_char, in_pad_mode)
{
    in_string = in_string + '';
    let pad = in_pad_char.repeat(in_pad_amount);
    let new_length = Math.max(in_string.length, in_pad_amount);
    if (in_pad_mode === STR_PAD_LEFT) {
        return (pad + in_string).slice(-new_length);
    } else {
        return (in_string + pad).substring(0, new_length);
    }
}

// ******************************

function combine_columns(in_cols_1, in_cols_2, in_col_margin)
{
    in_col_margin = typeof(in_col_margin) === 'undefined' ? 10 : in_col_margin;

    let result = false;

    do
    {
        let rows = in_cols_1;

        let cols_1_max_width = in_cols_1.reduce((a,b) => { return Math.max(color_line_length(b), a); }, 0);
        let cols_2_max_width = in_cols_2.reduce((a,b) => { return Math.max(color_line_length(b), a); }, 0);

        let row_idx = 0;
        in_cols_2.forEach(col => {
            let row = '';
            if (rows[row_idx])
            {
                row = rows[row_idx];
                let row_color_length = row.length - color_line_length(row);
                let row_min_length = cols_1_max_width + row_color_length;
                row = str_pad(row, row_min_length, ' ', STR_PAD_RIGHT);
            }

            let col_color_length = col.length - color_line_length(col);
            let col_min_length = cols_2_max_width + col_color_length;
            col = str_pad(col, col_min_length, ' ', STR_PAD_RIGHT);

            row = row + ' '.repeat(in_col_margin) + col;
            rows[row_idx] = row;
            row_idx++;
        });

        result = rows;
    }
    while (false);

    return result;
}

// ******************************

function color_line_length(in_line)
{
    let result = false;

    do
    {
        let regexp = new RegExp(/\x1b\[(0;)?([0-9]+)?m/, 'gm');
        let plain_line = ((in_line || '') + '').replace(regexp, '');
        result = plain_line.length;
    }
    while (false);

    return result;
}

// ******************************
// Exports:
// ******************************
