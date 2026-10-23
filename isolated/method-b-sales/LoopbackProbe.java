import java.net.*;
public class LoopbackProbe {
  public static void main(String[] args) throws Exception {
    if (System.getSecurityManager() == null) throw new AssertionError("SecurityManager absent");
    for (String host : new String[]{"192.0.2.1", "169.254.169.254", "2001:db8::1"}) {
      try { System.getSecurityManager().checkConnect(host, 443); throw new AssertionError("outbound allowed: " + host); }
      catch (SecurityException expected) { System.out.println("DENIED " + host); }
    }
    for (String host : new String[]{"127.0.0.1", "::1"}) {
      InetAddress addr = InetAddress.getByName(host);
      try (ServerSocket server = new ServerSocket(0, 1, addr);
           Socket client = new Socket(addr, server.getLocalPort()); Socket accepted = server.accept()) {
        System.out.println("LOOPBACK " + host);
      }
    }
  }
}
