#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "@aws-cdk/core";
import { AwsSpringBootStack } from "../lib/aws-spring-boot-stack";

const app = new cdk.App();
new AwsSpringBootStack(app, "AwsSpringBootStack", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
});
