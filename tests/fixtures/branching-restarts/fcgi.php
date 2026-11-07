<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */
declare(strict_types=1);
// Internal experiment probe over Unix sockets; never exposed by nginx.
[$script, $socket, $filename, $uri, $query] = $argv;
$stream = stream_socket_client('unix://' . $socket, $errno, $error, 3);
if (!$stream) throw new RuntimeException($error);
stream_set_timeout($stream, 30);
function record(int $type, string $body): string { return pack('CCnnCC', 1, $type, 1, strlen($body), 0, 0) . $body; }
function lengthField(int $n): string { return $n < 128 ? chr($n) : pack('N', $n | 0x80000000); }
$params = ['REQUEST_METHOD'=>'GET', 'SCRIPT_FILENAME'=>$filename, 'SCRIPT_NAME'=>$uri,
    'REQUEST_URI'=>$uri . ($query ? '?' . $query : ''), 'QUERY_STRING'=>$query,
    'SERVER_PROTOCOL'=>'HTTP/1.1', 'SERVER_NAME'=>'localhost', 'SERVER_PORT'=>'80',
    'REMOTE_ADDR'=>'127.0.0.1', 'GATEWAY_INTERFACE'=>'CGI/1.1'];
$body=''; foreach ($params as $name=>$value) $body .= lengthField(strlen($name)).lengthField(strlen($value)).$name.$value;
fwrite($stream, record(1, pack('nC', 1, 0).str_repeat("\0",5)).record(4,$body).record(4,'').record(5,''));
function readBytes($stream, int $n): string { $out='';while(strlen($out)<$n){$part=fread($stream,$n-strlen($out));if($part===false||$part==='')throw new RuntimeException('Incomplete FastCGI response');$out.=$part;}return $out; }
$stdout='';$stderr='';
while(true){$h=unpack('Cversion/Ctype/nid/nlength/Cpadding/Creserved',readBytes($stream,8));$chunk=$h['length']?readBytes($stream,$h['length']):'';if($h['padding'])readBytes($stream,$h['padding']);if($h['type']===6)$stdout.=$chunk;if($h['type']===7)$stderr.=$chunk;if($h['type']===3)break;}
fclose($stream);
if($stderr!=='')throw new RuntimeException($stderr);
$parts=explode("\r\n\r\n",$stdout,2);if(count($parts)!==2)throw new RuntimeException('Missing FastCGI headers');
if(preg_match('/^Status: (?!200)/mi',$parts[0]))throw new RuntimeException($parts[0]);
json_decode($parts[1],true,512,JSON_THROW_ON_ERROR);echo $parts[1];
