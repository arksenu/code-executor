#!/usr/bin/env ruby
require 'json'
require 'fileutils'
require 'open3'
require 'timeout'

spec = JSON.parse($stdin.read)
limits = spec['limits'] || {}
Dir.chdir('/work')

ENV.clear
(spec['env'] || {}).each { |k, v| ENV[k] = v }
ENV['HOME'] = '/work'
ENV['TMPDIR'] = '/work/tmp'
ENV['PATH'] = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'

FileUtils.mkdir_p('tmp')
FileUtils.mkdir_p('outputs')

cmd = ['ruby', 'main.rb', '--', *(spec['args'] || [])]
stdout_str = ''
stderr_str = ''
status = nil
begin
  Timeout.timeout((limits['timeout_ms'] || 5000) / 1000.0) do
    stdout_str, stderr_str, status = Open3.capture3(*cmd)
  end
rescue Timeout::Error
  stderr_str = 'Execution timed out'
  status = Struct.new(:exitstatus).new(124)
end

limit = limits['max_output_bytes'] || 1024 * 1024
$stdout.write(stdout_str.byteslice(0, limit) || '')
$stderr.write(stderr_str.byteslice(0, limit) || '')

usage = {
  wall_ms: limits['timeout_ms'] || 5000,
  cpu_ms: limits['cpu_ms'] || 5000,
  max_rss_mb: limits['memory_mb'] || 256
}
File.write('usage.json', usage.to_json)

exit(status ? status.exitstatus : 0)
