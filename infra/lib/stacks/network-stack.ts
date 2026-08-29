// infra/lib/stacks/network-stack.ts
//
// Hasta esta versión, `network-stack.ts` figuraba en el árbol de la sección
// 6.1 marcado como "opcional en fase 1: VPC solo si se requiere" — y la
// sección 9.4 confirmaba que las Lambdas NO necesitan VPC (acceden a Aurora
// por Data API, un endpoint HTTPS público autenticado por IAM, no una
// conexión TCP). Eso sigue siendo cierto y no cambia acá.
//
// Lo que se descubrió al escribir el `DataStack` real (changelog de esta
// versión): el propio *cluster* de Aurora sí necesita una VPC para
// existir — es un requisito de `aws-cdk-lib/aws-rds` (y de RDS en general)
// independiente de cómo se accede a los datos después. No es una
// contradicción con 9.4, es un matiz que esa sección no distinguía todavía:
// "las Lambdas no necesitan VPC" y "el cluster de Aurora necesita una VPC
// propia" son dos afirmaciones distintas, ambas ciertas a la vez.
//
// Se resuelve con la VPC más barata posible: **sin NAT Gateway** (el costo
// fijo que se quería evitar, ver 9.4) y con un solo tipo de subred —
// `PRIVATE_ISOLATED` (sin salida a internet, ni siquiera vía NAT) — porque
// nada de lo que corre acá necesita salir a internet: el cluster no llama a
// nada externo, y la Data API se invoca desde las Lambdas (fuera de esta
// VPC) contra el endpoint regional de AWS, no contra la VPC. Costo
// incremental de esta VPC: **$0/mes** — una VPC en sí no tiene costo, solo
// sus componentes (NAT Gateway, VPC endpoints, etc.), ninguno de los cuales
// se crea acá.

import { Stack, type StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import type { Construct } from 'constructs';

export interface NetworkStackProps extends StackProps {
  readonly grupoId: string;
  readonly ambiente: string;
}

export class NetworkStack extends Stack {
  /** VPC mínima, solo para alojar el cluster de Aurora (ver nota arriba) — ninguna Lambda se adjunta a esta VPC. */
  public readonly vpc: ec2.IVpc;

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2, // mínimo que exige un cluster de Aurora (subredes en al menos 2 AZ)
      natGateways: 0, // sin NAT — nada acá necesita salida a internet, ver nota de cabecera
      subnetConfiguration: [
        {
          name: 'aurora-isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });
  }
}
